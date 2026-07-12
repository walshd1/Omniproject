import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksToIcsEvents, issuesToIcsEvents } from "./calendar-feed";
import type { Task, Row } from "../broker/types";

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

test("a task with reminderAt gets an alarm on its event", () => {
  const [ev] = tasksToIcsEvents([T({ id: "r", dueDate: "2026-09-01", reminderAt: "2026-08-31T09:00:00Z" })]);
  assert.equal(ev!.alarm?.at, "2026-08-31T09:00:00Z");
});

test("issuesToIcsEvents emits deadline events; milestones are flagged; closed/undated skipped", () => {
  const rows: Row[] = [
    { id: "i1", title: "Beta cutover", status: "in_progress", dueDate: "2026-10-01", type: "milestone" },
    { id: "i2", title: "Fix login", status: "open", dueDate: "2026-10-02" },
    { id: "i3", title: "No date", status: "open" },              // undated → skipped
    { id: "i4", title: "Shipped", status: "done", dueDate: "2026-09-01" }, // closed → skipped
  ];
  const events = issuesToIcsEvents(rows);
  assert.deepEqual(events.map((e) => e.uid), ["issue-i1@omniproject", "issue-i2@omniproject"]);
  assert.equal(events[0]!.summary, "◆ Beta cutover"); // milestone flagged
  assert.match(events[0]!.description ?? "", /Milestone/);
  assert.match(events[1]!.description ?? "", /Deadline/);
});

test("issuesToIcsEvents honours mineFor by assignee", () => {
  const rows: Row[] = [
    { id: "a", title: "Mine", status: "open", dueDate: "2026-10-01", assignee: "pat@demo" },
    { id: "b", title: "Theirs", status: "open", dueDate: "2026-10-01", assignee: "sam@demo" },
  ];
  assert.deepEqual(issuesToIcsEvents(rows, { mineFor: ["pat@demo"] }).map((e) => e.uid), ["issue-a@omniproject"]);
});
