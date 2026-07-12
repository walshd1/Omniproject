import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for admin-defined field-validation rules: the settings slice (GET/PUT, bad-pattern
 * 400) AND enforcement on the projects write path (a value that violates a rule is a 400). The admin
 * write-gate is `requireRole("admin")`; under the harness's demo auth every session clears it, so the
 * reachable slice branches are 200 / 400 (the 403 is covered by rbac unit tests).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ fieldValidation: [] });
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /field-validation defaults to []", async () => {
  const r = await h.req("/field-validation", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).fieldValidation, []);
});

test("an admin saves a well-formed rule set → 200", async () => {
  const rules = [{ field: "name", required: true, pattern: "^[A-Z]" }, { field: "budget", min: 0 }];
  const r = await h.req("/field-validation", { method: "PUT", cookie: adminCookie(), body: { fieldValidation: rules } });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).fieldValidation, rules);
});

test("an uncompilable pattern is rejected → 400", async () => {
  const r = await h.req("/field-validation", { method: "PUT", cookie: adminCookie(), body: { fieldValidation: [{ field: "name", pattern: "[" }] } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /valid regular expression/);
});

test("a project write violating a rule is blocked → 400 with the rule message", async () => {
  await h.req("/field-validation", { method: "PUT", cookie: adminCookie(), body: { fieldValidation: [{ field: "name", pattern: "^[A-Z]" }] } });
  // PATCH proj-001's name to a lowercase value — violates the pattern.
  const bad = await h.req("/projects/proj-001", { method: "PATCH", cookie: adminCookie(), body: { name: "lowercase" } });
  assert.equal(bad.status, 400);
  assert.match((await json(bad)).error, /name/);
});

test("a project write satisfying the rule passes → 200", async () => {
  await h.req("/field-validation", { method: "PUT", cookie: adminCookie(), body: { fieldValidation: [{ field: "name", pattern: "^[A-Z]" }] } });
  const ok = await h.req("/projects/proj-001", { method: "PATCH", cookie: adminCookie(), body: { name: "Renamed" } });
  assert.equal(ok.status, 200);
});
