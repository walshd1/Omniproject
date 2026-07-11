import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the federated-peer registry error branches (routes/federated-peers.ts) that
 * the happy-path suite (__tests__/federated-portfolio.test.ts) doesn't reach: the "peers must be
 * an array" guard and the SettingsValidationError → 400 mapping when a submitted peer fails the
 * settings-store shape check. Admin-gated (demo auth clears it).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ federatedPeers: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /federated-peers: no cookie → 401", async () => {
  const r = await h.req("/federated-peers");
  assert.equal(r.status, 401);
});

test("PUT /federated-peers: a non-array `peers` → 400 (route-level guard)", async () => {
  const r = await h.req("/federated-peers", { method: "PUT", cookie: adminCookie(), body: { peers: "nope" } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /peers must be an array/i);
});

test("PUT /federated-peers: a peer that fails settings validation → 400 (SettingsValidationError mapped)", async () => {
  // Well-formed enough to pass the route's Array.isArray gate, but missing baseUrl so
  // updateSettings throws SettingsValidationError.
  const r = await h.req("/federated-peers", {
    method: "PUT", cookie: adminCookie(),
    body: { peers: [{ id: "eu", label: "EU", token: "t" }] },
  });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /baseUrl/i);
});
