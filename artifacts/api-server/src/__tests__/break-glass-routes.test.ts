import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * Break-glass containment — the IdP-independent panic button for admin impersonation. Self-authed by
 * BREAK_GLASS_TOKEN (a local secret, not a session), it can ONLY lock the deployment read-only + rotate
 * the session key (eject everyone) and release that — never read/mutate data. Off unless the token is set.
 */
const TOKEN = "break-glass-super-strong-token-1234567890";
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());

afterEach(async () => {
  delete process.env["BREAK_GLASS_TOKEN"];
  const { releaseMaintenance } = await import("../lib/maintenance");
  const { __resetKeyRegistry } = await import("../lib/key-registry");
  releaseMaintenance();
  __resetKeyRegistry();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("disabled by default: the surface 404s when BREAK_GLASS_TOKEN is unset", async () => {
  const r = await h.req("/break-glass/status", { headers: { "x-break-glass-token": TOKEN } });
  assert.equal(r.status, 404);
});

test("enabled but wrong/absent token → 401", async () => {
  process.env["BREAK_GLASS_TOKEN"] = TOKEN;
  assert.equal((await h.req("/break-glass/status")).status, 401); // no token
  assert.equal((await h.req("/break-glass/status", { headers: { "x-break-glass-token": "nope" } })).status, 401);
});

test("a weak token does NOT enable break-glass (min length)", async () => {
  process.env["BREAK_GLASS_TOKEN"] = "too-short";
  const r = await h.req("/break-glass/status", { headers: { "x-break-glass-token": "too-short" } });
  assert.equal(r.status, 404); // treated as disabled
});

test("lockdown engages read-only mode + rotates the session key (ejects sessions), then release lifts it", async () => {
  process.env["BREAK_GLASS_TOKEN"] = TOKEN;
  const hdr = { "x-break-glass-token": TOKEN };

  // Before: an admin write works.
  const before = await h.req("/admin/role-map", { method: "PUT", cookie: adminCookie(), body: { admin: ["x"] } });
  assert.notEqual(before.status, 503);

  // LOCK DOWN.
  const lock = await h.req("/break-glass/lockdown", { method: "POST", headers: hdr, body: { reason: "impersonation suspected" } });
  assert.equal(lock.status, 200);
  const body = await json(lock);
  assert.equal(body.maintenance, true);
  assert.ok(body.sessionKeyVersion >= 2, "session key was rotated (all sessions invalidated)");

  // During lockdown: a mutating request is refused read-only (503); status still reachable via token.
  const blocked = await h.req("/programmes", { method: "POST", cookie: adminCookie(), body: { name: "x" } });
  assert.equal(blocked.status, 503);
  assert.equal((await h.req("/break-glass/status", { headers: hdr })).status, 200);

  // RELEASE.
  const rel = await h.req("/break-glass/release", { method: "POST", headers: hdr });
  assert.equal(rel.status, 200);
  assert.equal((await json(rel)).maintenance, false);
});
