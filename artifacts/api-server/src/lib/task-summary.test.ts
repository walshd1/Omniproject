import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseTasks } from "./task-summary";
import type { Task } from "../broker/types";

const T = (o: Partial<Task>): Task => ({ id: "t", title: "t", status: "next", ...o });
const NOW = new Date("2026-07-12T00:00:00Z");

test("summariseTasks breaks tasks down by GTD class and open/actionable", () => {
  const tasks: Task[] = [
    T({ id: "a", status: "next", assignee: "pat", tags: ["x"], context: "@computer" }),
    T({ id: "b", status: "waiting", assignee: "sam" }),
    T({ id: "c", status: "someday" }),
    T({ id: "d", status: "done" }),
    T({ id: "e", status: "dropped" }),
  ];
  const s = summariseTasks(tasks, NOW);
  assert.equal(s.total, 5);
  assert.deepEqual(s.byClass, { actionable: 1, waiting: 1, deferred: 1, done: 1, dropped: 1 });
  assert.equal(s.open, 3); // next + waiting + someday
  assert.equal(s.actionable, 1); // only 'next'
  assert.deepEqual(s.byAssignee, { pat: 1, sam: 1 });
  assert.equal(s.unassigned, 1); // the 'someday' task
  assert.deepEqual(s.byTag, { x: 1 });
  assert.deepEqual(s.byContext, { "@computer": 1 });
});

test("overdue and dueSoon are counted for OPEN tasks only, against `now`", () => {
  const tasks: Task[] = [
    T({ id: "past-open", status: "next", dueDate: "2026-07-01" }),   // overdue
    T({ id: "soon", status: "next", dueDate: "2026-07-15" }),         // within 7 days
    T({ id: "far", status: "next", dueDate: "2026-12-01" }),          // neither
    T({ id: "past-done", status: "done", dueDate: "2026-07-01" }),    // closed → ignored
  ];
  const s = summariseTasks(tasks, NOW);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueSoon, 1);
});

test("unknown/absent status counts as actionable (default-safe)", () => {
  const s = summariseTasks([T({ status: "" }), T({ status: "bespoke" })], NOW);
  assert.equal(s.byClass.actionable, 2);
  assert.equal(s.actionable, 2);
});
