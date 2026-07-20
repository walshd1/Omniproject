import { test } from "node:test";
import assert from "node:assert/strict";

// Env set BEFORE importing the broker module (getBroker reads the opt-in once). Isolated to this
// file's process by the test runner.
process.env["BUILTIN_BROKER"] = "memory";
delete process.env["BROKER_URL"];

import { BuiltinBroker, MemoryStore } from "./index";
import { structuralConformance, runReadConformance } from "../conformance";
import { BrokerError, type ActorContext } from "../types";
import { updateSettings } from "../../lib/settings";

const ctx: ActorContext = { sub: "founder", email: "founder@charity.test", role: "admin" };
const fresh = () => new BuiltinBroker(new MemoryStore());

test("built-in broker is a REAL, live backend (not demo/sample)", () => {
  const b = fresh();
  assert.equal(b.live, true);
  assert.equal(b.kind, "builtin:memory");
});

test("passes structural + read conformance (with data) — a first-class Broker", async () => {
  const b = fresh();
  // Seed one project + issue so the project-scoped read checks actually run.
  const p = await b.createProject(ctx, { name: "Seed" });
  await b.writeIssue(ctx, "create", { projectId: p.id, title: "Seed issue", status: "todo" });

  const structural = structuralConformance(b);
  assert.ok(structural.ok, `structural failures: ${JSON.stringify(structural.checks.filter((c) => !c.ok))}`);
  const read = await runReadConformance(b, ctx);
  assert.ok(read.ok, `read failures: ${JSON.stringify(read.checks.filter((c) => !c.ok))}`);
});

test("starts EMPTY and round-trips project + issue CRUD, keeping roll-up counts", async () => {
  const b = fresh();
  assert.deepEqual(await b.listProjects(ctx), []); // real backend starts empty, no samples

  const project = await b.createProject(ctx, { name: "Food Bank", identifier: "FB" });
  assert.equal(project.name, "Food Bank");
  const created = await b.writeIssue(ctx, "create", { projectId: project.id, title: "Find a venue", status: "todo" });
  assert.ok(created?.id);

  const updated = await b.writeIssue(ctx, "update", { projectId: project.id, issueId: created!.id, status: "done", expectedVersion: created!.version });
  assert.equal(updated!.status, "done");
  assert.equal(updated!.version, (created!.version ?? 1) + 1);

  // The project's denormalised counts followed the issue's lifecycle.
  const summary = await b.projectSummary(ctx, project.id);
  assert.equal(summary.total, 1);
  assert.equal(summary.completionRate, 100);
  const health = await b.portfolioHealth(ctx);
  assert.equal(health[0]!.ragStatus, "green"); // 100% complete → green

  await b.writeIssue(ctx, "delete", { projectId: project.id, issueId: created!.id });
  assert.deepEqual(await b.listIssues(ctx, project.id), []);
});

test("scope enforcement: a programme-scoped caller only sees its programme's projects (listProjects + portfolioHealth)", async () => {
  const b = fresh();
  const alpha = await b.createProject(ctx, { name: "Alpha proj", omniInstanceId: "guid-alpha" });
  const beta = await b.createProject(ctx, { name: "Beta proj", omniInstanceId: "guid-beta" });
  try {
    // Register programme "alpha" containing ONLY alpha's correlation GUID.
    updateSettings({ programmeRegistry: { alpha: { name: "Alpha", instanceIds: ["guid-alpha"] } } });
    const scoped: ActorContext = { sub: "mgr", role: "manager", scope: { level: "programme", programmes: ["alpha"] } };

    // Before the fix the built-in store returned BOTH projects to this scoped caller (whole-portfolio leak).
    const visible = await b.listProjects(scoped);
    assert.deepEqual(visible.map((p) => p.id), [alpha.id]);
    const health = await b.portfolioHealth(scoped);
    assert.deepEqual(health.map((h) => h.projectId), [alpha.id]);

    // An all-scope (admin) caller still sees both — the filter only narrows non-`all` scopes.
    assert.equal((await b.listProjects(ctx)).length, 2);
    // A programme with no matching membership sees nothing (fail-closed).
    const none = await b.listProjects({ sub: "x", scope: { level: "programme", programmes: ["ghost"] } });
    assert.deepEqual(none, []);
    void beta;
  } finally {
    updateSettings({ programmeRegistry: {} });
  }
});

test("optimistic concurrency: a stale expectedVersion is a conflict; a missing issue is not_found", async () => {
  const b = fresh();
  const project = await b.createProject(ctx, { name: "P" });
  const issue = await b.writeIssue(ctx, "create", { projectId: project.id, title: "x" });

  await assert.rejects(
    () => b.writeIssue(ctx, "update", { projectId: project.id, issueId: issue!.id, status: "done", expectedVersion: 999 }),
    (e: unknown) => e instanceof BrokerError && e.code === "conflict",
  );
  await assert.rejects(
    () => b.writeIssue(ctx, "update", { projectId: project.id, issueId: "nope", status: "done" }),
    (e: unknown) => e instanceof BrokerError && e.code === "not_found",
  );
});

test("RAID round-trips through the store", async () => {
  const b = fresh();
  const project = await b.createProject(ctx, { name: "P" });
  const entry = await b.addRaid(ctx, project.id, { type: "risk", title: "Funding gap" });
  assert.ok(entry["id"]);
  const raid = await b.listRaid(ctx, project.id);
  assert.equal(raid.length, 1);
  assert.equal(raid[0]!["title"], "Funding gap");
});

test("tasks round-trip through the store: create defaults, list/scope, update stamps completion", async () => {
  const b = fresh();
  const project = await b.createProject(ctx, { name: "P" });
  const t = await b.createTask!(ctx, { title: "Call the auditor", projectId: project.id, context: "@calls" });
  assert.match(t.id, /^task-/);
  assert.equal(t.status, "next");        // default GTD status
  assert.equal(t.priority, "none");      // default
  assert.deepEqual(t.tags, []);
  assert.equal(t.completedAt, null);
  assert.equal(t.source, "builtin");

  // A standalone task (no project) + project scoping.
  await b.createTask!(ctx, { title: "Standalone" });
  assert.equal((await b.listTasks!(ctx)).length, 2);
  assert.equal((await b.listTasks!(ctx, { projectId: project.id })).length, 1);

  // Completing stamps completedAt; a fetch reflects it.
  const done = await b.updateTask!(ctx, t.id, { status: "done" });
  assert.equal(done.status, "done");
  assert.match(done.completedAt!, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await b.getTask!(ctx, t.id))!.completedAt, done.completedAt);
});

test("updateTask on a missing task is not_found", async () => {
  await assert.rejects(() => fresh().updateTask!(ctx, "task-nope", { title: "x" }), (e: unknown) => e instanceof BrokerError && e.code === "not_found");
});

test("getBroker() selects the built-in broker when BUILTIN_BROKER is set", async () => {
  const { getBroker } = await import("../index");
  const b = getBroker();
  assert.equal(b.kind, "builtin:memory");
  assert.equal(b.live, true);
});
