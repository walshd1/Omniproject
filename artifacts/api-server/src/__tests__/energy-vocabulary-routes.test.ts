import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * HTTP coverage for the scope-overridable GTD energy-level vocabulary AND the relaxed task energy write-gate:
 *  - GET  /api/energy-vocabulary — the resolved levels for the caller's scope (any authed user).
 *  - PUT  /api/energy-vocabulary — write the org-scope override (admin/PMO), through the validated def path.
 *  - POST /api/tasks accepts a scope-ADDED energy level (the frozen enum gate is relaxed) but still 400s garbage.
 */

// The sealed store must be on a temp dir so the org override persists where the booted app reads it.
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "energy-vocab-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (r: Response): Promise<any> => r.json();

test("GET /energy-vocabulary returns the shipped 3 GTD energy levels before anything is authored", async () => {
  const r = await h.req("/energy-vocabulary", { cookie: adminCookie() });
  assert.equal(r.status, 200);
  assert.deepEqual((await json(r)).levels.map((l: { id: string }) => l.id), ["low", "medium", "high"]);
});

test("the resolved endpoint requires auth", async () => {
  assert.equal((await h.req("/energy-vocabulary")).status, 401);
});

test("PUT /energy-vocabulary adds a level; a task can then be written with it, garbage is 400", async () => {
  // Before: the scope-added level is not yet a valid energy → the write is rejected.
  const before = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "Deep work", energy: "extreme" } });
  assert.equal(before.status, 400);

  // Org adds an "extreme" GTD energy level bound to ordinal 4.
  const put = await h.req("/energy-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [
    { id: "extreme", label: "Extreme", level: 4, order: 3, methodologies: ["gtd"] },
    { id: "low", label: "Chilled" }, // relabel a shipped one too
  ] } });
  assert.equal(put.status, 200);
  const resolved = await json(put);
  assert.ok(resolved.levels.some((l: { id: string }) => l.id === "extreme"), "the added level resolves");
  assert.equal(resolved.levels.find((l: { id: string }) => l.id === "low").label, "Chilled");

  // After: the scope-added level is accepted on write.
  const created = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "Deep work", energy: "extreme" } });
  assert.equal(created.status, 201);
  assert.equal((await json(created)).energy, "extreme");

  // A truly-unknown level is still rejected.
  const garbage = await h.req("/tasks", { method: "POST", cookie: adminCookie(), body: { title: "x", energy: "turbo" } });
  assert.equal(garbage.status, 400);
});

test("PUT /energy-vocabulary rejects a new level with no ordinal level → 400", async () => {
  assert.equal((await h.req("/energy-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [{ id: "extreme", label: "Extreme", order: 4 }] } })).status, 400);
  assert.equal((await h.req("/energy-vocabulary", { method: "PUT", cookie: adminCookie(), body: { levels: [{ id: "extreme", label: "Extreme", level: 0, order: 4 }] } })).status, 400);
});
