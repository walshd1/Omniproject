import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * HTTP-level coverage for cross-instance portfolio federation (backlog #135):
 *  - GET /api/portfolio/summary   — the local, peer-callable aggregate (never per-project detail)
 *  - GET /api/federated-portfolio — this instance's summary + every configured peer's, merged
 *  - GET/PUT /api/federated-peers — the admin-gated peer registry (tokens redacted on read)
 *
 * Drives the REAL Express app (demo broker, so /portfolio/summary has real non-empty totals to
 * merge) plus small in-process HTTP servers standing in for peer instances — one healthy, one
 * that 401s, one simply not listening — so the "unreachable/misconfigured peer degrades
 * gracefully" requirement is exercised end-to-end, not mocked at the function level.
 */
const SECRET = "test-session-secret-federated-portfolio";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "test";
process.env["RATE_LIMIT_DISABLED"] = "true";
delete process.env["OIDC_ISSUER_URL"]; // demo mode → every session is admin

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
// stepUpAt is stamped so the step-up-gated PUT /api/federated-peers (peer bearer-token write) passes;
// demo auth grants admin, and the fresh step-up clears requireStepUp. Reads ignore the extra field.
const SESSION = signedSessionCookie({ sub: "user-1", email: "u@test", roles: [], stepUpAt: Date.now() });

let server: Server;
let base: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let updateSettings: (patch: Record<string, unknown>) => any;

before(async () => {
  const { default: app } = await import("../app");
  ({ updateSettings } = await import("../lib/settings"));
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => { server?.close(); });
afterEach(() => { updateSettings({ federatedPeers: [] }); });

const get = (path: string, init?: RequestInit) =>
  fetch(`${base}${path}`, { ...init, headers: { cookie: SESSION, ...(init?.headers ?? {}) } });

// Test-local JSON reader: the endpoints under test return loosely-typed aggregate payloads, so we
// read them as `any` to keep the assertions terse (mirrors __tests__/integration-routes.test.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = async (res: Response): Promise<any> => res.json();

function startPeer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ server: http.Server; base: string }> {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      resolve({ server: s, base: `http://127.0.0.1:${port}` });
    });
  });
}

test("GET /api/portfolio/summary: THIS instance's own pre-aggregated totals — never per-project rows", async () => {
  const res = await get("/api/portfolio/summary");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok(json.projects > 0);
  assert.ok(json.health); // demo broker declares the portfolio capability
  assert.equal(typeof json.health.projects, "number");
  // The demo broker models tasks, so the aggregate folds in a GTD task roll-up.
  assert.ok(json.tasks && typeof json.tasks.total === "number");
  assert.equal(typeof json.tasks.overdue, "number");
  // The roll-up accounts for where projects live (live / closed-in-SOR / archived) via the source plan.
  assert.ok(json.sources && Array.isArray(json.sources.live) && Array.isArray(json.sources.sor) && Array.isArray(json.sources.archive));
  // No per-project identifiers ever appear in the aggregate.
  assert.equal(JSON.stringify(json).includes("projectId"), false);
  assert.equal(JSON.stringify(json).includes("projectName"), false);
});

test("GET /api/federated-portfolio: no peers configured ⇒ local only, empty peers array", async () => {
  const res = await get("/api/federated-portfolio");
  assert.equal(res.status, 200);
  const json = await readJson(res);
  assert.ok(json.local.summary.projects > 0);
  assert.deepEqual(json.peers, []);
});

test("GET /api/federated-portfolio: merges a healthy peer, an unauthorized peer, and an unreachable peer — one bad peer never fails the whole view", async () => {
  const good = await startPeer((req, res) => {
    assert.equal(req.headers["authorization"], "Bearer good-token");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ projects: 7, health: { projects: 7, rag: { green: 5, amber: 1, red: 1, other: 0 }, avgScheduleVarianceDays: 1, avgBudgetVariancePercentage: 2, totalActiveBlockers: 3 }, finance: null, capacity: null }));
  });
  const denied = await startPeer((_req, res) => { res.writeHead(401); res.end("{}"); });

  updateSettings({
    federatedPeers: [
      { id: "eu", label: "EU", baseUrl: good.base, token: "good-token", region: "eu", active: true },
      { id: "apac", label: "APAC", baseUrl: denied.base, token: "wrong-token", region: "apac", active: true },
      { id: "us", label: "US (down)", baseUrl: "http://127.0.0.1:1", token: "x", region: "us", active: true },
      { id: "disabled", label: "Disabled peer", baseUrl: "http://127.0.0.1:1", token: "x", region: "za", active: false },
    ],
  });

  try {
    const res = await get("/api/federated-portfolio");
    assert.equal(res.status, 200);
    const json = await readJson(res);
    assert.ok(json.local.summary.projects > 0);
    assert.equal(json.peers.length, 3); // the inactive peer is excluded, not just skipped-with-error

    const byId = Object.fromEntries(json.peers.map((p: { id: string }) => [p.id, p]));
    assert.equal(byId["eu"].status, "ok");
    assert.equal(byId["eu"].summary.projects, 7);
    assert.equal(byId["eu"].region, "eu");
    assert.equal(byId["apac"].status, "unauthorized");
    assert.equal(byId["apac"].summary, null);
    assert.equal(byId["us"].status, "unreachable");
    assert.equal(byId["us"].summary, null);
  } finally {
    good.server.close();
    denied.server.close();
  }
});

test("GET/PUT /api/federated-peers: admin-gated CRUD, tokens redacted on read and preserved across a masked re-submit", async () => {
  const putRes = await get("/api/federated-peers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peers: [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", token: "real-secret", region: "eu", active: true }] }),
  });
  assert.equal(putRes.status, 200);
  const created = await readJson(putRes);
  assert.equal(created.peers[0].tokenSet, true);
  assert.equal("token" in created.peers[0], false); // never echoes the plaintext token back

  const getRes = await get("/api/federated-peers");
  const listed = await readJson(getRes);
  assert.equal(listed.peers[0].tokenSet, true);

  // Re-submit with the masked placeholder (what the admin UI would round-trip) — the real token
  // underneath must survive, not be overwritten with the literal mask.
  await get("/api/federated-peers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ peers: [{ id: "eu", label: "EU (renamed)", baseUrl: "https://eu.omni.example", token: "********", region: "eu", active: true }] }),
  });
  const { getSettings } = await import("../lib/settings");
  assert.equal(getSettings().federatedPeers[0]!.token, "real-secret");
  assert.equal(getSettings().federatedPeers[0]!.label, "EU (renamed)");
});

test("a hostile peer body is sanitised — no prototype pollution, no raw injection; non-JSON peer → error", async () => {
  const hostile = await startPeer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"__proto__":{"polluted":true},"projects":"not-a-number","health":"garbage","sources":{"live":["p1",42],"sor":"x"}}');
  });
  const broken = await startPeer((_req, res) => { res.writeHead(200); res.end("this is not json"); });
  updateSettings({ federatedPeers: [
    { id: "evil", label: "Evil", baseUrl: hostile.base, token: "t", region: "x", active: true },
    { id: "broke", label: "Broken", baseUrl: broken.base, token: "t", region: "y", active: true },
  ] });
  try {
    const json = await readJson(await get("/api/federated-portfolio"));
    const byId = Object.fromEntries(json.peers.map((p: { id: string }) => [p.id, p]));
    // Hostile body accepted only after sanitising: projects→0, non-object health→null, sources filtered.
    assert.equal(byId["evil"].status, "ok");
    assert.equal(byId["evil"].summary.projects, 0);
    assert.equal(byId["evil"].summary.health, null);
    assert.deepEqual(byId["evil"].summary.sources.live, ["p1"]); // 42 filtered out
    assert.equal(byId["evil"].summary.sources.sor.length, 0);   // non-array → []
    // Unparseable body → error, never accepted as a summary.
    assert.equal(byId["broke"].status, "error");
    // The "__proto__" key never polluted this process's Object.prototype.
    assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
  } finally { hostile.server.close(); broken.server.close(); }
});
