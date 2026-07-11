import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { processBrokerCall, backend, type BrokerBackend } from "./reference-broker-blueprint";
import { signBrokerRequest, signBrokerResponse, __resetBrokerHmac, type CanonicalRequest } from "../lib/broker-hmac";
import { updateSettings } from "../lib/settings";
import type { ActorContext } from "./types";

/**
 * Broker protocol v2 — the request signature is now actually VERIFIED by the broker (F3a),
 * covers the whole routing surface (F3), and the session binding no longer leaks in
 * cleartext on a sealed hop (F2).
 */

beforeEach(() => __resetBrokerHmac());

// A backend that answers list_projects with data, so a PASSED signature yields 200 (a bad
// signature short-circuits to 401 before ever reaching the backend).
const okBackend = { ...backend, async listProjects() { return [{ id: "p1", name: "P" }]; } } as BrokerBackend;

/** Build a valid, unsealed signed request (rawBody + headers) for the given envelope. */
function signedRequest(over: Partial<{ action: string; source: string; origin: string; idempotencyKey: string }> = {}) {
  const envelope = { action: "list_projects", payload: {}, source: "pm", origin: "omniproject", idempotencyKey: "idem-1", ...over };
  const body = JSON.stringify(envelope);
  const canonical: CanonicalRequest = { action: envelope.action, source: envelope.source, idempotencyKey: envelope.idempotencyKey, origin: envelope.origin, body };
  const sig = signBrokerRequest(canonical);
  const headers: Record<string, string> = {
    "x-omni-sig": sig.sig, "x-omni-ts": String(sig.ts), "x-omni-nonce": sig.nonce,
    "x-omniproject-action": envelope.action, "x-omniproject-source": envelope.source,
    "x-omniproject-origin": envelope.origin, "x-omniproject-idempotency-key": envelope.idempotencyKey,
  };
  return { body, headers, action: envelope.action };
}

test("F3a: a validly signed request passes verification (reaches the backend)", async () => {
  const { body, headers, action } = signedRequest();
  const r = await processBrokerCall({ rawBody: body, actionHeader: action, headers }, okBackend);
  assert.equal(r.status, 200);
  assert.deepEqual((r.body as { data: unknown }).data, [{ id: "p1", name: "P" }]);
});

test("F3a: a tampered routing header is rejected 401 (the source can't be swapped)", async () => {
  const { body, headers, action } = signedRequest();
  // Attacker reroutes to a different backend source without re-signing.
  const r = await processBrokerCall({ rawBody: body, actionHeader: action, headers: { ...headers, "x-omniproject-source": "financial_ledger" } }, okBackend);
  assert.equal(r.status, 401);
  assert.match(String((r.body as { message: string }).message), /signature bad-signature/);
});

test("F3a: a replayed nonce is rejected 401", async () => {
  const { body, headers, action } = signedRequest();
  assert.equal((await processBrokerCall({ rawBody: body, actionHeader: action, headers }, okBackend)).status, 200);
  const replay = await processBrokerCall({ rawBody: body, actionHeader: action, headers }, okBackend);
  assert.equal(replay.status, 401);
  assert.match(String((replay.body as { message: string }).message), /signature replay/);
});

test("F3a: an unsigned request is allowed by default but rejected under BROKER_REQUIRE_SIG", async () => {
  const body = JSON.stringify({ action: "list_projects", payload: {} });
  // Default: verify-when-present → unsigned reaches the backend.
  assert.equal((await processBrokerCall({ rawBody: body, actionHeader: "list_projects" }, okBackend)).status, 200);
  // Strict opt-in: unsigned is a hard 401.
  process.env["BROKER_REQUIRE_SIG"] = "true";
  try {
    const r = await processBrokerCall({ rawBody: body, actionHeader: "list_projects" }, okBackend);
    assert.equal(r.status, 401);
    assert.match(String((r.body as { message: string }).message), /missing request signature/);
  } finally {
    delete process.env["BROKER_REQUIRE_SIG"];
  }
});

test("F3a: an unsigned verify/readiness probe is allowed even under BROKER_REQUIRE_SIG", async () => {
  process.env["BROKER_REQUIRE_SIG"] = "true";
  try {
    const body = JSON.stringify({ action: "__ready", payload: {}, verify: true });
    const r = await processBrokerCall({ rawBody: body, actionHeader: "__ready" }, okBackend);
    assert.equal(r.status, 200);
    assert.equal((r.body as { data: { verified: boolean } }).data.verified, true);
  } finally {
    delete process.env["BROKER_REQUIRE_SIG"];
  }
});

// ── F2: end-to-end, a sealed hop leaks neither the identity nor a bind header ──────────
function pointBroker(url: string | null): void { updateSettings({ brokerUrl: url }); }

test("F2: with PSK on, a session-bound request carries no identity/bind in cleartext, and still verifies", async () => {
  const captured: Array<{ body: string; headers: http.IncomingHttpHeaders }> = [];
  // A recording broker: capture the exact wire the gateway emits, then hand the bytes to the
  // broker core so we also prove the sealed binding still verifies end-to-end.
  const record = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      captured.push({ body: raw, headers: req.headers });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: [], message: null }));
    });
  });
  await new Promise<void>((r) => record.listen(0, () => r()));
  const port = (record.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"]; const prevPsk = process.env["BROKER_PSK"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  process.env["BROKER_PSK"] = "an-integration-shared-broker-key";
  pointBroker(`http://127.0.0.1:${port}`);
  try {
    const { ReferenceBroker } = await import("./reference-broker");
    const broker = new ReferenceBroker();
    const ctx: ActorContext = {
      sub: "alice", email: "alice@example.test", role: "admin", authHeader: "Bearer secret-token",
      sessionBind: { sub: "alice", smono: "12345", salt: "deadbeefcafe" },
    };
    await broker.listProjects(ctx);

    assert.equal(captured.length, 1);
    const { body: wire, headers } = captured[0]!;
    // The acting identity (bind sub) and token must NOT appear in cleartext...
    assert.ok(!wire.includes("alice"), "the acting user's identity leaked in the sealed body");
    assert.ok(!wire.includes("deadbeefcafe"), "the session salt leaked in the sealed body");
    assert.ok(!wire.includes("secret-token"), "the bearer token leaked");
    // ...and NONE of the X-Omni-Bind-* headers are sent when sealed (F2).
    assert.ok(!headers["x-omni-bind-sub"], "bind sub sent as a cleartext header despite PSK");
    assert.ok(!headers["x-omni-bind-salt"], "bind salt sent as a cleartext header despite PSK");
    // The signature IS present (verification still applies)...
    assert.ok(headers["x-omni-sig"], "the request signature header is present");
    // ...and the sealed bytes genuinely verify at a real broker.
    const opened = JSON.parse(wire) as { enc?: string };
    const r = await processBrokerCall({ rawBody: wire, headers: headers as Record<string, string | string[] | undefined> }, okBackend);
    assert.notEqual(r.status, 401, "the sealed, session-bound request failed to verify at the broker");
    assert.ok(typeof opened.enc === "string" && opened.enc.startsWith("p2."), "the seal uses the v2 (p2.) format");
  } finally {
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    if (prevPsk === undefined) delete process.env["BROKER_PSK"]; else process.env["BROKER_PSK"] = prevPsk;
    pointBroker(null);
    await new Promise<void>((r) => record.close(() => r()));
  }
});

// ── Response signing: the gateway rejects a tampered / (in strict mode) unsigned reply ──────
function pointBrokerUrl(url: string | null): void { updateSettings({ brokerUrl: url }); }

/** Stand up a broker that returns `body` with the given response-signature headers, run the
 *  gateway's ReferenceBroker.listProjects against it, and return the promise. */
async function withBrokerReturning(
  respHeaders: (wire: string) => Record<string, string>,
  run: (broker: { listProjects: (ctx: ActorContext) => Promise<unknown> }) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => {
      const wire = JSON.stringify({ success: true, data: [{ id: "p1", name: "P" }], message: null });
      res.writeHead(200, { "Content-Type": "application/json", ...respHeaders(wire) });
      res.end(wire);
    });
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  const port = (server.address() as AddressInfo).port;
  const prevUrl = process.env["BROKER_URL"];
  process.env["BROKER_URL"] = `http://127.0.0.1:${port}`;
  pointBrokerUrl(`http://127.0.0.1:${port}`);
  try {
    const { ReferenceBroker } = await import("./reference-broker");
    await run(new ReferenceBroker());
  } finally {
    if (prevUrl === undefined) delete process.env["BROKER_URL"]; else process.env["BROKER_URL"] = prevUrl;
    pointBrokerUrl(null);
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const ctx: ActorContext = { sub: "tester", email: "t@example.test", role: "admin", authHeader: "Bearer t" };

test("response signing: a correctly signed reply is accepted", async () => {
  await withBrokerReturning(
    (wire) => { const rs = signBrokerResponse(wire); return { "X-Omni-Resp-Sig": rs.sig, "X-Omni-Resp-Ts": String(rs.ts) }; },
    async (broker) => { assert.deepEqual(await broker.listProjects(ctx), [{ id: "p1", name: "P" }]); },
  );
});

test("response signing: a reply with a BAD signature is rejected (not surfaced as data)", async () => {
  const { BrokerError } = await import("./types");
  await withBrokerReturning(
    () => ({ "X-Omni-Resp-Sig": "deadbeef", "X-Omni-Resp-Ts": String(Date.now()) }),
    async (broker) => { await assert.rejects(() => broker.listProjects(ctx), (e: unknown) => e instanceof BrokerError); },
  );
});

test("response signing: an UNSIGNED reply is accepted by default but rejected under BROKER_REQUIRE_RESP_SIG", async () => {
  const { BrokerError } = await import("./types");
  // Default: verify-when-present → an unsigned reply still works.
  await withBrokerReturning(() => ({}), async (broker) => {
    assert.deepEqual(await broker.listProjects(ctx), [{ id: "p1", name: "P" }]);
  });
  // Strict: an unsigned reply is refused.
  process.env["BROKER_REQUIRE_RESP_SIG"] = "1";
  try {
    await withBrokerReturning(() => ({}), async (broker) => {
      await assert.rejects(() => broker.listProjects(ctx), (e: unknown) => e instanceof BrokerError);
    });
  } finally {
    delete process.env["BROKER_REQUIRE_RESP_SIG"];
  }
});

// ── Capability protocol advertisement + detection ───────────────────────────────────────
test("protocol detection: warns for a broker lacking v2 sig support, silent when advertised", async () => {
  const { brokerProtocolWarning } = await import("./reference-broker");
  const { BROKER_PROTOCOL_SUPPORT } = await import("./reference-broker-blueprint");
  // The reference broker advertises v2 → no warning.
  assert.equal(BROKER_PROTOCOL_SUPPORT.sig.includes("v2"), true);
  assert.equal(brokerProtocolWarning({ issues: true, protocol: BROKER_PROTOCOL_SUPPORT }), null);
  // A v1-only broker, or one that omits `protocol`, warns.
  assert.match(String(brokerProtocolWarning({ protocol: { sig: ["v1"] } })), /does not advertise v2/);
  assert.match(String(brokerProtocolWarning({ issues: true })), /does not advertise v2/);
  assert.match(String(brokerProtocolWarning(undefined)), /does not advertise v2/);
});
