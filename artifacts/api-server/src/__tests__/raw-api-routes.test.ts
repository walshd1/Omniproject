import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, stepUpAdminCookie, type Harness } from "./_harness";

/**
 * Raw broker passthrough (the last-resort escape hatch). RAW_API_ENABLED is set before the
 * app imports so the surface exists; it is admin + step-up gated. With a broker URL wired at
 * runtime the body-validation + command-dispatch branches become reachable (the command
 * itself fails against the bogus URL, exercising the error catch).
 */
process.env["RAW_API_ENABLED"] = "true";

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
const BROKER_URL = "https://example.com/webhook"; // public host: passes the egress guard, fails as a real broker
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: null });
});

test("no cookie is 401", async () => {
  const r = await h.req("/admin/raw", { method: "POST", body: { action: "list_projects" } });
  assert.equal(r.status, 401);
});

test("admin without a fresh step-up is 403 step_up_required", async () => {
  const r = await h.req("/admin/raw", { method: "POST", cookie: adminCookie(), body: { action: "list_projects" } });
  assert.equal(r.status, 403);
  assert.equal((await r.json() as { code: string }).code, "step_up_required");
});

test("with a broker wired, a missing/blank action is 400", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: BROKER_URL });
  const r = await h.req("/admin/raw", { method: "POST", cookie: stepUpAdminCookie(), body: { payload: {} } });
  assert.equal(r.status, 400);
});

test("with a broker wired, a non-object payload is 400", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: BROKER_URL });
  const r = await h.req("/admin/raw", { method: "POST", cookie: stepUpAdminCookie(), body: { action: "x", payload: [1, 2] } });
  assert.equal(r.status, 400);
});

test("a valid action against an unreachable broker surfaces the broker error, and sets the raw warning header", async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ brokerUrl: BROKER_URL });
  const r = await h.req("/admin/raw", { method: "POST", cookie: stepUpAdminCookie(), body: { action: "list_projects", payload: { foo: "bar" } } });
  // The command dispatches (audit + the raw-warning header, both set BEFORE the broker call)
  // then fails against the unreachable host -> the broker error is surfaced (status varies
  // with the upstream: 4xx/5xx). The point is the dispatch + catch branch was exercised.
  assert.ok(r.status >= 400, `expected a broker error status, got ${r.status}`);
  assert.equal(r.headers.get("x-omniproject-raw-warning"), "bypasses contract+capability+ruleset; admin-only last resort");
});
