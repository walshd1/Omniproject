import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAttachmentsClient, registerAttachmentsFromEnv, attachmentsSidecar } from "./sidecar-client";

/** A fake fetch that records calls and returns canned responses keyed by `METHOD path`. */
function fakeFetch(routes: Record<string, { status?: number; json?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: String(url), method, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
    const r = routes[`${method} ${u.pathname}`] ?? { status: 200, json: {} };
    const status = r.status ?? 200;
    const headers = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json ?? {},
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const BASE = "http://attachments-broker:8091";

test("headBlob returns the size from x-attachment-size, and null on 404", async () => {
  const { impl, calls } = fakeFetch({
    "HEAD /blob/hit": { status: 200, headers: { "x-attachment-size": "42" } },
    "HEAD /blob/miss": { status: 404 },
  });
  const client = makeAttachmentsClient({ baseUrl: BASE, token: "t0k", fetchImpl: impl });
  assert.deepEqual(await client.headBlob("hit"), { size: 42 });
  assert.equal(await client.headBlob("miss"), null);
  assert.equal(calls[0]!.method, "HEAD");
  assert.equal(calls[0]!.headers["authorization"], "Bearer t0k");
});

test("delBlob tolerates a 404 (idempotent) and health maps ok", async () => {
  const { impl } = fakeFetch({ "DELETE /blob/gone": { status: 404 }, "GET /healthz": { status: 200 } });
  const client = makeAttachmentsClient({ baseUrl: BASE, fetchImpl: impl });
  await client.delBlob("gone"); // must not throw
  assert.equal(await client.health(), true);
});

test("canMintTickets is false without a public URL + secret, true with both", () => {
  const { impl } = fakeFetch({});
  assert.equal(makeAttachmentsClient({ baseUrl: BASE, fetchImpl: impl }).canMintTickets(), false);
  assert.equal(makeAttachmentsClient({ baseUrl: BASE, publicUrl: "https://cdn.example", fetchImpl: impl }).canMintTickets(), false);
  assert.equal(makeAttachmentsClient({ baseUrl: BASE, ticketSecret: "s", fetchImpl: impl }).canMintTickets(), false);
  assert.equal(makeAttachmentsClient({ baseUrl: BASE, publicUrl: "https://cdn.example", ticketSecret: "s", fetchImpl: impl }).canMintTickets(), true);
});

test("mintPortalUrl builds a public portal URL with a signed, op+key+exp-scoped ticket", () => {
  const { impl } = fakeFetch({});
  const client = makeAttachmentsClient({
    baseUrl: BASE, publicUrl: "https://cdn.example/", ticketSecret: "shhh", fetchImpl: impl, now: () => 1_000_000,
  });
  const { url, expiresAt } = client.mintPortalUrl("put", "abc123", { room: "issue:p1:i1" });
  assert.ok(url.startsWith("https://cdn.example/portal/abc123?ticket="));
  assert.ok(expiresAt > 1_000_000); // in the future relative to the injected clock
  const ticket = new URL(url).searchParams.get("ticket")!;
  const [body, mac] = ticket.split(".");
  assert.ok(body && mac);
  const payload = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
  assert.equal(payload.op, "put");
  assert.equal(payload.key, "abc123");
  assert.equal(payload.room, "issue:p1:i1");
  assert.equal(payload.exp, expiresAt);
});

test("mintPortalUrl throws when the byte-path isn't configured", () => {
  const { impl } = fakeFetch({});
  const client = makeAttachmentsClient({ baseUrl: BASE, fetchImpl: impl });
  assert.throws(() => client.mintPortalUrl("get", "k1"), /not configured/);
});

test("registerAttachmentsFromEnv is off-by-default and gates the client", () => {
  assert.equal(registerAttachmentsFromEnv({} as NodeJS.ProcessEnv), false);
  assert.equal(attachmentsSidecar(), null);
  assert.equal(
    registerAttachmentsFromEnv({
      ATTACHMENTS_SIDECAR_URL: BASE,
      ATTACHMENTS_SIDECAR_TOKEN: "t",
      ATTACHMENTS_SIDECAR_PUBLIC_URL: "https://cdn.example",
      ATTACHMENTS_TICKET_SECRET: "s",
    } as unknown as NodeJS.ProcessEnv),
    true,
  );
  const c = attachmentsSidecar();
  assert.ok(c);
  assert.equal(c!.canMintTickets(), true);
  // Unsetting clears it again.
  assert.equal(registerAttachmentsFromEnv({} as NodeJS.ProcessEnv), false);
  assert.equal(attachmentsSidecar(), null);
});
