import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the scope-overridable GTD task-status vocabulary AND the relaxed task write-gate:
 *  - GET  /api/task-vocabulary — the resolved statuses for the caller's scope (any authed user).
 *  - PUT  /api/task-vocabulary — write the org-scope override (admin/PMO), through the validated def path.
 *  - POST /api/tasks accepts a scope-ADDED status (the frozen enum gate is relaxed) but still 400s garbage.
 */

// The sealed store must be on a temp dir so the org override persists where the booted app reads it.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "task-vocab-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /task-vocabulary returns the shipped 6 GTD statuses before anything is authored", async () => {
  const r = await h.req("/task-vocabulary", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).statuses.map((s: { id: string }) => s.id), ["next", "waiting", "scheduled", "someday", "done", "dropped"]);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/task-vocabulary")).status, 401);
});

test("PUT /task-vocabulary adds a status; a task can then be written with it, garbage is 400", async () => {
  // Before: the scope-added status is not yet a valid task status → the write is rejected.
  const before = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "Chase vendor", status: "delegated" } });
  assert.equal(before.status, 400);

  // Org adds a "delegated" GTD status bound to the waiting class.
  const put = await h.req("/task-vocabulary", { method: "PUT", cookie: adminCookie(), body: { statuses: [
    { id: "delegated", label: "Delegated", class: "waiting", order: 6, methodologies: ["gtd"] },
    { id: "waiting", label: "Blocked" }, // relabel a shipped one too
  ] } });
  assert.equal(put.status, 200);
  const resolved = await json(put);
  assert.ok(resolved.statuses.some((s: { id: string }) => s.id === "delegated"), "the added status resolves");
  assert.equal(resolved.statuses.find((s: { id: string }) => s.id === "waiting").label, "Blocked");

  // After: the scope-added status is accepted on write.
  const created = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "Chase vendor", status: "delegated" } });
  assert.equal(created.status, 201);
  assert.equal((await json(created)).status, "delegated");

  // A truly-unknown status is still rejected.
  const garbage = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "x", status: "nonsense" } });
  assert.equal(garbage.status, 400);
});

test("PUT /task-vocabulary rejects a new status with no workflow class → 400", async () => {
  assert.equal((await h.req("/task-vocabulary", { method: "PUT", cookie: adminCookie(), body: { statuses: [{ id: "parked", label: "Parked", order: 7 }] } })).status, 400);
  // The issue lifecycle classes are NOT valid GTD classes (the axes are kept separate).
  assert.equal((await h.req("/task-vocabulary", { method: "PUT", cookie: adminCookie(), body: { statuses: [{ id: "parked", label: "Parked", class: "cancelled", order: 7 }] } })).status, 400);
});
