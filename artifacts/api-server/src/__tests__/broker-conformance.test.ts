import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "../broker/demo";
import { N8nBroker } from "../broker/n8n";
import { runReadConformance, structuralConformance } from "../broker/conformance";
import type { Broker, ActorContext } from "../broker/types";

/**
 * Broker conformance — every method of the Broker contract must be satisfiable by
 * an implementation. The read-only + structural checks live in the broker-agnostic
 * suite (broker/conformance.ts) so the SAME assertions run against:
 *   - DemoBroker        → the reference pass (here),
 *   - N8nBroker (live)  → the real-world pass (the verify-broker CI step).
 * The mutation tests below stay DemoBroker-only so the suite can never write to a
 * real backend.
 */

const ctx: ActorContext = { sub: "demo", role: "admin" };

function reportDetail(checks: { name: string; ok: boolean; detail?: string }[]): string {
  return checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("; ");
}

test("DemoBroker is the reference pass for the read-only conformance suite", async () => {
  const b: Broker = new DemoBroker();
  assert.equal(b.live, false);
  const res = await runReadConformance(b, ctx);
  assert.ok(res.ok, `read conformance failed: ${reportDetail(res.checks)}`);
});

test("both brokers structurally implement the full contract surface", () => {
  for (const b of [new DemoBroker(), new N8nBroker()] as Broker[]) {
    const res = structuralConformance(b);
    assert.ok(res.ok, `${b.kind} is missing contract methods: ${reportDetail(res.checks)}`);
  }
});

test("DemoBroker carries per-task financials through create and update", async () => {
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;
  const created = await b.writeIssue(ctx, "create", {
    projectId: pid, title: "costed task", budget: 12000, actualCost: 3000, billable: true, costCenter: "FIN-1", currency: "GBP",
  });
  assert.ok(created);
  const read = await b.getIssue(ctx, pid, created!.id);
  assert.equal(read!.budget, 12000);
  assert.equal(read!.actualCost, 3000);
  assert.equal(read!.billable, true);
  assert.equal(read!.costCenter, "FIN-1");
  assert.equal(read!.currency, "GBP");

  // An update patches the financials through.
  const updated = await b.writeIssue(ctx, "update", { projectId: pid, issueId: created!.id, actualCost: 9000 });
  assert.equal((updated as { actualCost?: number }).actualCost, 9000);
  assert.equal((updated as { budget?: number }).budget, 12000, "untouched financials are preserved");

  await b.writeIssue(ctx, "delete", { projectId: pid, issueId: created!.id });
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

test("DemoBroker exposes project members with an access level", async () => {
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;
  const members = await b.projectMembers(ctx, pid);
  assert.ok(members.length > 0, "returns a roster");
  for (const m of members) assert.ok(m.access === "read" || m.access === "write", "each member has an access level");
  assert.ok(members.some((m) => m.access === "write"), "at least one writer (assignable)");
  assert.ok(members.some((m) => m.access === "read"), "and at least one read-only member");
});

test("DemoBroker satisfies the task-children contract (raise issue + add note)", async () => {
  const b: Broker = new DemoBroker();
  const pid = (await b.listProjects(ctx))[0]!.id;
  const taskId = (await b.listIssues(ctx, pid))[0]!.id;

  const before = (await b.listTaskItems(ctx, pid, taskId)).length;
  const issue = await b.createTaskItem(ctx, pid, taskId, { kind: "issue", content: "Found a defect" });
  const note = await b.createTaskItem(ctx, pid, taskId, { kind: "note", content: "Spoke to the vendor" });
  assert.equal(issue.kind, "issue");
  assert.equal(note.kind, "note");
  assert.equal(issue.taskId, taskId);

  const after = await b.listTaskItems(ctx, pid, taskId);
  assert.equal(after.length, before + 2, "both children are listed under the task");
});

test("DemoBroker satisfies the project write contract (create → update / programme grouping)", async () => {
  const b: Broker = new DemoBroker();

  const created = await b.createProject(ctx, { name: "Conformance Programme Project" });
  assert.ok(created.id && created.name === "Conformance Programme Project", "createProject returns a project");

  // grouping under a programme via updateProject (the derived-programme mechanism)
  const grouped = await b.updateProject(ctx, created.id, { programmeId: "prog-conf" });
  assert.equal((grouped as { programmeId?: string }).programmeId, "prog-conf");

  // the new project is now listed
  const ids = (await b.listProjects(ctx)).map((p) => p.id);
  assert.ok(ids.includes(created.id), "created project appears in listProjects");
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
