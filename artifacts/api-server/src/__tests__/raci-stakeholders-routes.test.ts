import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/raci.ts + routes/stakeholders.ts over the REAL app — the editable register stores behind the RACI
 * and Stakeholders screens. GET/PUT (manager-gated write) + a /rows endpoint the screen table binds to.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => { const { updateSettings } = await import("../lib/settings"); updateSettings({ raci: [], stakeholders: [], collectionEditRoles: {} }); });
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

test("RACI: save + rows round-trip", async () => {
  const raci = [{ id: "r1", task: "Deploy", role: "Ops", responsibility: "A" }];
  assert.equal((await req("/raci", { method: "PUT", body: { raci } })).status, 200);
  const rows = (await (await req("/raci/rows")).json()) as { rows: Array<{ task: string; responsibility: string }> };
  assert.deepEqual(rows.rows[0], { task: "Deploy", role: "Ops", responsibility: "A" });
});

test("RACI: bad responsibility → 400", async () => {
  const r = await req("/raci", { method: "PUT", body: { raci: [{ id: "r1", task: "t", role: "x", responsibility: "Z" }] } });
  assert.equal(r.status, 400);
});

test("Stakeholders: save + rows round-trip", async () => {
  const stakeholders = [{ id: "s1", name: "Ada", role: "Sponsor", influence: "high", interest: "medium" }];
  assert.equal((await req("/stakeholders", { method: "PUT", body: { stakeholders } })).status, 200);
  const rows = (await (await req("/stakeholders/rows")).json()) as { rows: Array<{ name: string; influence: string }> };
  assert.equal(rows.rows[0]!.name, "Ada");
  assert.equal(rows.rows[0]!.influence, "high");
});

test("collectionEditRoles: read-only blocks every write; default allows it", async () => {
  const { updateSettings } = await import("../lib/settings");
  // Locked read-only → even the admin session is refused.
  updateSettings({ collectionEditRoles: { raci: "readonly" } });
  assert.equal((await req("/raci", { method: "PUT", body: { raci: [] } })).status, 403);
  // Unset → default user-editable, the write goes through.
  updateSettings({ collectionEditRoles: {} });
  assert.equal((await req("/raci", { method: "PUT", body: { raci: [] } })).status, 200);
});

test("collectionEditRoles: a configured role gate is enforced under real RBAC", async () => {
  const { updateSettings } = await import("../lib/settings");
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    // Raise RACI to pmo+ → a plain member is refused, reads stay open.
    updateSettings({ collectionEditRoles: { raci: "pmo" } });
    assert.equal((await h.req("/raci", { cookie: memberCookie(), method: "PUT", body: { raci: [] } })).status, 403);
    assert.equal((await h.req("/raci/rows", { cookie: memberCookie() })).status, 200);
  } finally { updateSettings({ collectionEditRoles: {} }); if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});
