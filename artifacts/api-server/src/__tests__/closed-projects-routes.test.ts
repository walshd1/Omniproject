import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the closed-project location registry (projectGuid → { disposition, … }). Read-open
 * to any authenticated session; writes gated to PMO/admin (the harness's demo admin clears that, so the
 * reachable branches are 200 / 400).
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h?.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ closedProjects: {}, retiredGuids: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /closed-projects defaults to {}", async () => {
  const r = await h.req("/closed-projects", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).closedProjects, {});
});

test("a well-formed registry is saved and normalised", async () => {
  const body = { closedProjects: { "guid-1": { disposition: "archive", note: " moved " }, "guid-2": { disposition: "sor", source: "jira" } } };
  const r = await h.req("/closed-projects", { method: "PUT", cookie: adminCookie(), body });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).closedProjects, {
    "guid-1": { disposition: "archive", note: "moved" },
    "guid-2": { disposition: "sor", source: "jira" },
  });
});

test("a bad disposition is rejected → 400", async () => {
  const r = await h.req("/closed-projects", { method: "PUT", cookie: adminCookie(), body: { closedProjects: { g: { disposition: "somewhere" } } } });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /disposition of sor or archive/);
});
