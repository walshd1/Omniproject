import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "../broker/demo";
import type { Broker, ActorContext } from "../broker/types";

/**
 * Broker conformance — every method of the Broker contract must be satisfiable by
 * an implementation, exercised here against the DemoBroker. This is the contract
 * any future broker (if n8n is ever superseded) must also pass; it also guards
 * against the read-model "long tail" methods silently breaking.
 */

const ctx: ActorContext = { sub: "demo", role: "admin" };

test("DemoBroker satisfies the full read contract", async () => {
  const b: Broker = new DemoBroker();
  assert.equal(typeof b.kind, "string");
  assert.equal(b.live, false);

  const projects = await b.listProjects(ctx);
  assert.ok(Array.isArray(projects) && projects.length > 0, "listProjects returns sample data");
  const pid = projects[0]!.id;

  const issues = await b.listIssues(ctx, pid);
  assert.ok(Array.isArray(issues), "listIssues returns an array");

  if (issues.length) {
    const one = await b.getIssue(ctx, pid, issues[0]!.id);
    assert.ok(one === null || one.id === issues[0]!.id, "getIssue returns the issue or null");
  }

  const verify = await b.verify(ctx);
  assert.equal(typeof verify.ok, "boolean");
  assert.ok(Array.isArray(verify.actions), "verify reports actions");

  assert.ok(Array.isArray(await b.listActivity(ctx)), "listActivity");

  const summary = await b.projectSummary(ctx, pid);
  assert.equal(summary.projectId, pid);
  assert.equal(typeof summary.total, "number");
  assert.equal(typeof summary.completionRate, "number");

  assert.ok(Array.isArray(await b.projectHistory(ctx, pid)), "projectHistory");

  const base = await b.baseline(ctx, pid);
  assert.ok(base === null || Array.isArray(base.items), "baseline");

  assert.ok(Array.isArray(await b.listRaid(ctx, pid)), "listRaid");
  assert.ok(Array.isArray(await b.notifications(ctx)), "notifications");
  assert.ok(Array.isArray(await b.portfolioHealth(ctx)), "portfolioHealth");
  assert.ok(Array.isArray(await b.resourceCapacity(ctx, pid)), "resourceCapacity");

  assert.equal(typeof (await b.projectFinancials(ctx, pid)), "object", "projectFinancials");
  assert.equal(typeof (await b.capabilities(ctx)), "object", "capabilities");

  const fx = await b.fxRates(ctx);
  assert.equal(typeof fx.base, "string");
  assert.ok(fx.rates && typeof fx.rates === "object", "fxRates");

  const states = await b.replay(ctx, {});
  assert.ok(Array.isArray(states), "replay returns an array of states");
  if (states.length) {
    assert.equal(typeof states[0]!.at, "string");
    assert.equal(typeof states[0]!.completionPct, "number");
    assert.ok(["replayed", "projected", "sourced", "derived", "sample"].includes(states[0]!.provenance));
  }
});

test("DemoBroker satisfies the write contract (create → update → delete)", async () => {
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;

  const created = await b.writeIssue(ctx, "create", { projectId: pid, title: "conformance issue" });
  assert.ok(created && created.id, "create returns an issue with an id");

  const updated = await b.writeIssue(ctx, "update", {
    projectId: pid,
    issueId: created!.id,
    status: "in_progress",
  });
  assert.ok(updated, "update returns the issue");

  // delete resolves without throwing (contract allows null).
  await b.writeIssue(ctx, "delete", { projectId: pid, issueId: created!.id });
});

test("DemoBroker keeps project issueCount/completedCount in lock-step with mutations", async () => {
  // The project card reads these denormalised counts for its completion %, so a
  // status change crossing "done" (and create/delete) must move them — otherwise
  // the card drifts from the board and the recomputed summary. Round-trips to
  // leave the shared demo dataset as found.
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;
  const before = (await b.listProjects(ctx)).find((p) => p.id === pid)!;
  const baseIssues = before["issueCount"] as number;
  const baseDone = before["completedCount"] as number;

  // Create a not-done issue: issueCount +1, completedCount unchanged.
  const created = await b.writeIssue(ctx, "create", { projectId: pid, title: "count check", status: "todo" });
  let row = (await b.listProjects(ctx)).find((p) => p.id === pid)!;
  assert.equal(row["issueCount"], baseIssues + 1, "create increments issueCount");
  assert.equal(row["completedCount"], baseDone, "create of a non-done issue leaves completedCount");

  // Move it to done: completedCount +1.
  await b.writeIssue(ctx, "update", { projectId: pid, issueId: created!.id, status: "done" });
  row = (await b.listProjects(ctx)).find((p) => p.id === pid)!;
  assert.equal(row["completedCount"], baseDone + 1, "status→done increments completedCount");

  // Delete the done issue: both counts return to baseline.
  await b.writeIssue(ctx, "delete", { projectId: pid, issueId: created!.id });
  row = (await b.listProjects(ctx)).find((p) => p.id === pid)!;
  assert.equal(row["issueCount"], baseIssues, "delete restores issueCount");
  assert.equal(row["completedCount"], baseDone, "delete of a done issue restores completedCount");
});

test("DemoBroker addRaid appends a row", async () => {
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;
  const row = await b.addRaid(ctx, pid, { type: "risk", title: "conformance risk", severity: "low" });
  assert.ok(row && typeof row === "object", "addRaid returns the created row");
});
