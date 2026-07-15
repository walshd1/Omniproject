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
afterEach(async () => { const { updateSettings } = await import("../lib/settings"); updateSettings({ raci: [], stakeholders: [] }); });
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

test("register writes are gated to manager under real RBAC", async () => {
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    assert.equal((await h.req("/raci", { cookie: memberCookie(), method: "PUT", body: { raci: [] } })).status, 403);
    assert.equal((await h.req("/stakeholders", { cookie: memberCookie(), method: "PUT", body: { stakeholders: [] } })).status, 403);
    assert.equal((await h.req("/raci/rows", { cookie: memberCookie() })).status, 200);
  } finally { if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});
