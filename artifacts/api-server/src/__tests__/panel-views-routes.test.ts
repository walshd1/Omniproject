import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, memberCookie, type Harness } from "./_harness";

/**
 * routes/panel-views.ts over the REAL app — the org store of saved filtered/pivoted panel views. GET is open;
 * PUT follows the collection edit-policy (default user-editable, admin can lock/raise). Malformed entries 400.
 */
let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => { const { updateSettings } = await import("../lib/settings"); updateSettings({ panelViews: [], collectionEditRoles: {} }); });
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

const VIEW = { id: "budget-plans:budget-all-periods:by-year", label: "By year", screen: "budget-plans", panel: "budget-all-periods", state: { groupBy: "period:year", agg: "sum", filters: { currency: ["GBP"] } } };

test("panel-views: save + read round-trip", async () => {
  assert.equal((await req("/panel-views", { method: "PUT", body: { panelViews: [VIEW] } })).status, 200);
  const got = (await (await req("/panel-views")).json()) as { panelViews: Array<{ id: string; label: string }> };
  assert.equal(got.panelViews.length, 1);
  assert.equal(got.panelViews[0]!.label, "By year");
});

test("panel-views: malformed entry → 400", async () => {
  // Missing screen scope.
  const r = await req("/panel-views", { method: "PUT", body: { panelViews: [{ id: "x", label: "L", panel: "p", state: { groupBy: "y", agg: "sum", filters: {} } }] } });
  assert.equal(r.status, 400);
});

test("panel-views: non-array filter values → 400", async () => {
  const bad = { ...VIEW, state: { groupBy: "period:year", agg: "sum", filters: { currency: "GBP" } } };
  assert.equal((await req("/panel-views", { method: "PUT", body: { panelViews: [bad] } })).status, 400);
});

test("panel-views: read-only policy blocks the write; default allows it", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ collectionEditRoles: { panelViews: "readonly" } });
  assert.equal((await req("/panel-views", { method: "PUT", body: { panelViews: [] } })).status, 403);
  updateSettings({ collectionEditRoles: {} });
  assert.equal((await req("/panel-views", { method: "PUT", body: { panelViews: [] } })).status, 200);
});

test("panel-views: a raised role gate is enforced; reads stay open", async () => {
  const { updateSettings } = await import("../lib/settings");
  const prev = process.env["OIDC_ISSUER_URL"]; process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  try {
    updateSettings({ collectionEditRoles: { panelViews: "pmo" } });
    assert.equal((await h.req("/panel-views", { cookie: memberCookie(), method: "PUT", body: { panelViews: [] } })).status, 403);
    assert.equal((await h.req("/panel-views", { cookie: memberCookie() })).status, 200);
  } finally { updateSettings({ collectionEditRoles: {} }); if (prev === undefined) delete process.env["OIDC_ISSUER_URL"]; else process.env["OIDC_ISSUER_URL"] = prev; }
});
