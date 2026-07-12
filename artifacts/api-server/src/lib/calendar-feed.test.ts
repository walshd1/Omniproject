import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksToIcsEvents } from "./calendar-feed";
import type { Task } from "../broker/types";

const T = (o: Partial<Task>): Task => ({ id: "t", title: "t", status: "next", ...o });

test("tasksToIcsEvents emits one all-day event per OPEN, due-dated task", () => {
  const events = tasksToIcsEvents([
    T({ id: "a", title: "Call the auditor", status: "next", dueDate: "2026-08-01", context: "@calls" }),
    T({ id: "b", title: "No due date", status: "next", dueDate: null }),        // undated → skipped
    T({ id: "c", title: "Already done", status: "done", dueDate: "2026-08-02" }), // closed → skipped
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.uid, "task-a@omniproject");
  assert.equal(events[0]!.summary, "Call the auditor");
  assert.equal(events[0]!.start, "2026-08-01");
  assert.equal(events[0]!.allDay, true);
  assert.match(events[0]!.description ?? "", /Context: @calls/);
});

test("mineFor keeps only tasks assigned to one of the caller's identifiers (case-insensitive)", () => {
  const tasks = [
    T({ id: "mine", dueDate: "2026-08-01", assignee: "Pat@Demo" }),
    T({ id: "theirs", dueDate: "2026-08-01", assignee: "sam@demo" }),
    T({ id: "nobody", dueDate: "2026-08-01", assignee: null }),
  ];
  const events = tasksToIcsEvents(tasks, { mineFor: ["pat@demo", "Pat Demo"] });
  assert.deepEqual(events.map((e) => e.uid), ["task-mine@omniproject"]);
});

test("without mineFor, every dated open task is included (scope=all)", () => {
  const tasks = [
    T({ id: "x", dueDate: "2026-08-01", assignee: "a@x" }),
    T({ id: "y", dueDate: "2026-08-02", assignee: "b@y" }),
  ];
  assert.equal(tasksToIcsEvents(tasks).length, 2);
});
