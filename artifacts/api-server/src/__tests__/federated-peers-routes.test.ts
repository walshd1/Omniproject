import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

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

test("PUT /federated-peers writes peer bearer tokens → step-up required (403 without a fresh step-up)", async () => {
  const r = await h.req("/federated-peers", { method: "PUT", cookie: adminCookie(), body: { peers: [] } });
  assert.equal(r.status, 403);
  assert.equal((await json(r)).code, "step_up_required");
});

test("PUT /federated-peers: a non-array `peers` → 400 (route-level guard)", async () => {
  const r = await h.req("/federated-peers", { method: "PUT", cookie: stepUpAdminCookie(), body: { peers: "nope" } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /peers must be an array/i);
});

test("PUT /federated-peers: changing an existing peer's URL with a MASKED token is rejected (credential-redirect guard)", async () => {
  const { updateSettings, getSettings } = await import("../lib/settings");
  // Seed an existing, previously-approved peer holding a real bearer token.
  updateSettings({ federatedPeers: [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", token: "secret-token", region: null, active: true }] });
  // An admin who cannot read the token tries to point the peer at a new (attacker) host, sending the mask.
  const r = await h.req("/federated-peers", {
    method: "PUT", cookie: stepUpAdminCookie(),
    body: { peers: [{ id: "eu", label: "EU", baseUrl: "https://attacker.example", token: "********", region: null, active: true }] },
  });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /re-enter the token/i);
  // The stored peer is untouched — the URL was NOT redirected and the credential was NOT carried over.
  const peer = getSettings().federatedPeers.find((p) => p.id === "eu");
  assert.equal(peer?.baseUrl, "https://eu.omni.example");
  assert.equal(peer?.token, "secret-token");
});

test("PUT /federated-peers: arbitrary extra fields are dropped (no mass-assignment into the stored peer)", async () => {
  const { getSettings } = await import("../lib/settings");
  const r = await h.req("/federated-peers", {
    method: "PUT", cookie: stepUpAdminCookie(),
    body: { peers: [{ id: "eu", label: "EU", baseUrl: "https://eu.omni.example", token: "t", region: null, active: true, evil: "x", __proto__: { polluted: true } }] },
  });
  // Applies (or holds for sign-off) — either way the stored peer carries ONLY the whitelisted fields.
  assert.ok(r.status === 200 || r.status === 202, `unexpected status ${r.status}`);
  const peer = getSettings().federatedPeers.find((p) => p.id === "eu");
  if (peer) assert.deepEqual(Object.keys(peer).sort(), ["active", "baseUrl", "id", "label", "region", "token"]);
});

test("PUT /federated-peers: a peer that fails settings validation → 400 (SettingsValidationError mapped)", async () => {
  // Well-formed enough to pass the route's Array.isArray gate, but missing baseUrl so
  // updateSettings throws SettingsValidationError.
  const r = await h.req("/federated-peers", {
    method: "PUT", cookie: stepUpAdminCookie(),
    body: { peers: [{ id: "eu", label: "EU", token: "t" }] },
  });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /baseUrl/i);
});
