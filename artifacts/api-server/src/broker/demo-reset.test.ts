import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker, resetDemoBrokerState } from "./demo";
import { demoResetIntervalMinutes } from "./demo-data";

/**
 * Periodic demo-data reset — bounds how long one visitor's edits (or deliberate
 * vandalism) on a shared public demo instance stay visible to every other
 * concurrent visitor. The scheduler itself fires on a real timer (see demo.ts);
 * these tests drive `resetDemoBrokerState()` directly rather than waiting on it.
 */
const ctx = { sub: "tester" } as never;

test("a write mutates the shared demo store, and a reset restores the pristine seed", async () => {
  const broker = new DemoBroker();
  const before = await broker.listProjects();
  const beforeCount = before.length;

  const created = await broker.createProject(ctx, { name: "Vandal project" });
  const afterCreate = await broker.listProjects();
  assert.equal(afterCreate.length, beforeCount + 1, "the write is visible (shared store)");
  assert.ok(afterCreate.some((p) => p.id === created.id));

  resetDemoBrokerState();

  const afterReset = await broker.listProjects();
  assert.equal(afterReset.length, beforeCount, "reset removes the injected row");
  assert.ok(!afterReset.some((p) => p.id === created.id));
});

test("a reset also clears demo-created issues, raid entries, and task items", async () => {
  const broker = new DemoBroker();
  const issue = await broker.writeIssue(ctx, "create", { projectId: "proj-001", title: "Injected issue" });
  const raid = await broker.addRaid(ctx, "proj-001", { type: "risk", title: "Injected risk", severity: "high" });
  const item = await broker.createTaskItem(ctx, "proj-001", "iss-001", { kind: "note", content: "Injected note" });

  resetDemoBrokerState();

  const issues = await broker.listIssues(ctx, "proj-001");
  assert.ok(!issues.some((i) => i.id === issue?.id));
  const raidRows = await broker.listRaid(ctx, "proj-001");
  assert.ok(!raidRows.some((r) => r["id"] === raid.id));
  const items = await broker.listTaskItems(ctx, "proj-001", "iss-001");
  assert.ok(!items.some((i) => i.id === item.id));
});

test("a reserved-key taskId (issueId route param) does not crash the task-item store", async () => {
  // The taskId is the caller-supplied `issueId` route param. With a plain-object store, `SAMPLE_TASK_ITEMS["__proto__"]`
  // resolves to Object.prototype so `?? []` / `??= []` keep a non-array and `.map`/`.push` throw a 500. The
  // null-prototype store must treat any id as plain data.
  const broker = new DemoBroker();
  for (const bad of ["__proto__", "constructor", "toString"]) {
    assert.deepEqual(await broker.listTaskItems(ctx, "proj-001", bad), []); // read: no crash, empty
    const created = await broker.createTaskItem(ctx, "proj-001", bad, { kind: "note", content: "x" }); // write: no crash
    const back = await broker.listTaskItems(ctx, "proj-001", bad);
    assert.ok(back.some((i) => i.id === created.id));
  }
  resetDemoBrokerState();
});

test("a reset restores a mutated existing row (not just new inserts)", async () => {
  const broker = new DemoBroker();
  const projectId = "proj-001";
  const originalName = (await broker.listProjects()).find((p) => p.id === projectId)?.name;
  assert.ok(originalName);

  await broker.updateProject(ctx, projectId, { name: "Defaced name" });
  const mutated = (await broker.listProjects()).find((p) => p.id === projectId);
  assert.equal(mutated?.name, "Defaced name");

  resetDemoBrokerState();

  const restored = (await broker.listProjects()).find((p) => p.id === projectId);
  assert.equal(restored?.name, originalName);
});

test("resetting twice in a row is safe and idempotent (the pristine snapshot is never itself mutated)", async () => {
  const broker = new DemoBroker();
  resetDemoBrokerState();
  const first = await broker.listProjects();
  resetDemoBrokerState();
  const second = await broker.listProjects();
  assert.deepEqual(first, second);
});

test("demoResetIntervalMinutes: defaults to 60, honours DEMO_RESET_MINUTES, and 0 means disabled", () => {
  const original = process.env["DEMO_RESET_MINUTES"];
  try {
    delete process.env["DEMO_RESET_MINUTES"];
    assert.equal(demoResetIntervalMinutes(), 60);
    process.env["DEMO_RESET_MINUTES"] = "15";
    assert.equal(demoResetIntervalMinutes(), 15);
    process.env["DEMO_RESET_MINUTES"] = "0";
    assert.equal(demoResetIntervalMinutes(), 0);
    process.env["DEMO_RESET_MINUTES"] = "not-a-number";
    assert.equal(demoResetIntervalMinutes(), 60, "an invalid value falls back to the default");
  } finally {
    if (original === undefined) delete process.env["DEMO_RESET_MINUTES"];
    else process.env["DEMO_RESET_MINUTES"] = original;
  }
});

// Restore a clean slate for any test file that runs after this one in the same process.
after(() => {
  resetDemoBrokerState();
});
before(() => {
  resetDemoBrokerState();
});
