import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the field-routing matrix endpoint. READ-open to any authenticated user (the
 * routing applies for everyone); writes persist the map and are rejected 400 on an anti-collision
 * violation. (The admin write-gate is enforced by requireRole("admin"); under the harness's demo
 * auth every session clears it, so the reachable branches are 401 / 200 / 400.)
 */
let h: Harness;
before(async () => { h = await startHarness(); });
after(() => h.close());
afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ fieldRouting: [] });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /routing: unauthenticated is rejected", async () => {
  assert.equal((await h.req("/routing")).status, 401);
});

test("GET /routing: defaults to an empty map", async () => {
  const r = await h.req("/routing", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).fieldRouting, []);
});

test("PUT /routing: a valid map round-trips", async () => {
  const body = { fieldRouting: [{ uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" }] };
  const r = await h.req("/routing", { method: "PUT", cookie: adminCookie(), body });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).fieldRouting, body.fieldRouting);
});

test("PUT /routing: a colliding map is a 400 (anti-collision), nothing persists", async () => {
  const collide = { fieldRouting: [
    { uiElement: "dueDate", vendor: "jira", broker: "n8n", sourceField: "duedate" },
    { uiElement: "dueDate", vendor: "sql", broker: "n8n", sourceField: "due" }, // same UI element
  ] };
  const r = await h.req("/routing", { method: "PUT", cookie: adminCookie(), body: collide });
  assert.equal(r.status, 400);
  assert.match((await json(r)).error, /already mapped|only one source/i);
  // Nothing persisted.
  const after = await h.req("/routing", { cookie: adminCookie() });
  assert.deepEqual((await json(after)).fieldRouting, []);
});
