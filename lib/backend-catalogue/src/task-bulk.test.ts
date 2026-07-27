import { test } from "node:test";
import assert from "node:assert/strict";
import { planTaskBulk, type BulkTask, type TaskBulkSpec } from "./task-bulk";

const t = (id: string, extra: Partial<BulkTask> = {}): BulkTask => ({ id, status: "next", ...extra });

test("complete: applies to open tasks, skips already-closed ones", () => {
  const tasks = [t("a"), t("b", { status: "done" }), t("c", { status: "dropped" })];
  const plan = planTaskBulk(tasks, { op: "complete" });
  assert.equal(plan.valid, true);
  assert.deepEqual(plan.items.find((i) => i.id === "a"), { id: "a", changes: { status: "done" }, skipped: false });
  assert.equal(plan.items.find((i) => i.id === "b")!.reason, "already closed");
  assert.equal(plan.summary.willApply, 1);
  assert.equal(plan.summary.willSkip, 2);
});

test("reopen: applies to closed tasks, skips open ones", () => {
  const plan = planTaskBulk([t("a", { status: "done" }), t("b")], { op: "reopen" });
  assert.deepEqual(plan.items.find((i) => i.id === "a")!.changes, { status: "next" });
  assert.equal(plan.items.find((i) => i.id === "b")!.reason, "not closed");
});

test("reassign: sets assignee, skips no-op, invalid without a target", () => {
  const plan = planTaskBulk([t("a", { assignee: "ada" }), t("b", { assignee: "bo" })], { op: "reassign", assignee: "ada" });
  assert.equal(plan.items.find((i) => i.id === "a")!.reason, "already assigned to that person");
  assert.deepEqual(plan.items.find((i) => i.id === "b")!.changes, { assignee: "ada" });
  const bad = planTaskBulk([t("a")], { op: "reassign" });
  assert.equal(bad.valid, false);
  assert.match(bad.reason!, /non-blank assignee/);
  assert.ok(bad.items.every((i) => i.skipped));
});

test("set_priority: validates against the allowed set when supplied", () => {
  const ok = planTaskBulk([t("a", { priority: "low" })], { op: "set_priority", priority: "high" }, { validPriorities: ["low", "medium", "high"] });
  assert.deepEqual(ok.items[0]!.changes, { priority: "high" });
  const bad = planTaskBulk([t("a")], { op: "set_priority", priority: "critical" }, { validPriorities: ["low", "medium", "high"] });
  assert.equal(bad.valid, false);
  assert.match(bad.reason!, /not a known priority/);
});

test("set_context / move_section: set the field, skip no-ops", () => {
  const ctx = planTaskBulk([t("a", { context: "calls" }), t("b")], { op: "set_context", context: "calls" });
  assert.equal(ctx.items.find((i) => i.id === "a")!.reason, "already in that context");
  assert.deepEqual(ctx.items.find((i) => i.id === "b")!.changes, { context: "calls" });
  const sec = planTaskBulk([t("a")], { op: "move_section", section: "Today" });
  assert.deepEqual(sec.items[0]!.changes, { section: "Today" });
});

test("unknown op ⇒ invalid, every item skipped", () => {
  const plan = planTaskBulk([t("a")], { op: "nuke" as unknown as TaskBulkSpec["op"] });
  assert.equal(plan.valid, false);
  assert.equal(plan.op, null);
  assert.ok(plan.items.every((i) => i.skipped));
  assert.match(plan.reason!, /unknown bulk op/);
});

test("fingerprint input is order-independent over ids and carries the op + params", () => {
  const a = planTaskBulk([t("b"), t("a"), t("c")], { op: "reassign", assignee: "ada" });
  const b = planTaskBulk([t("c"), t("a"), t("b")], { op: "reassign", assignee: "ada" });
  assert.deepEqual(a.fingerprintInput, b.fingerprintInput);
  assert.deepEqual(a.fingerprintInput, { op: "reassign", ids: ["a", "b", "c"], params: { assignee: "ada" } });
});

test("empty ⇒ empty; items are id-sorted", () => {
  const empty = planTaskBulk([], { op: "complete" });
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.summary, { total: 0, willApply: 0, willSkip: 0 });
  const sorted = planTaskBulk([t("z"), t("a"), t("m")], { op: "complete" });
  assert.deepEqual(sorted.items.map((i) => i.id), ["a", "m", "z"]);
});

test("malformed input is tolerated (never throws); ids coerced; non-objects dropped", () => {
  const tasks = [null, 5, { id: 7, status: "next" }, { status: "next" }] as unknown as BulkTask[];
  const plan = planTaskBulk(tasks, { op: "complete" });
  assert.equal(plan.summary.total, 1); // id:7 coerced to "7"; the id-less entry dropped
  assert.equal(plan.items[0]!.id, "7");
});

test("deterministic across identical runs", () => {
  const tasks = [t("a", { assignee: "x" }), t("b")];
  const spec: TaskBulkSpec = { op: "reassign", assignee: "y" };
  assert.deepEqual(planTaskBulk(tasks, spec), planTaskBulk(tasks, spec));
});
