import { test } from "node:test";
import assert from "node:assert/strict";
import { dueReminders, reminderFireKey, reminderNotification, runReminderSweep } from "./reminder-sweep";
import type { Task } from "../broker/types";

const task = (o: Partial<Task>): Task => ({ id: "t", title: "T", status: "next", ...o }) as Task;
const NOW = Date.parse("2026-03-10T09:00:00Z");

test("dueReminders selects past, not-done, not-fired reminders only", () => {
  const tasks = [
    task({ id: "past", reminderAt: "2026-03-10T08:00:00Z" }),            // due
    task({ id: "future", reminderAt: "2026-03-10T10:00:00Z" }),          // not yet
    task({ id: "none" }),                                                // no reminder
    task({ id: "done", reminderAt: "2026-03-10T08:00:00Z", status: "done" }), // completed
    task({ id: "fired", reminderAt: "2026-03-10T08:00:00Z" }),           // already fired
  ];
  const fired = new Set([reminderFireKey(task({ id: "fired", reminderAt: "2026-03-10T08:00:00Z" }))]);
  const due = dueReminders(tasks, NOW, (k) => fired.has(k));
  assert.deepEqual(due.map((t) => t.id), ["past"]);
});

test("reminderFireKey includes the timestamp so a reschedule fires again", () => {
  assert.notEqual(
    reminderFireKey(task({ id: "x", reminderAt: "2026-03-10T08:00:00Z" })),
    reminderFireKey(task({ id: "x", reminderAt: "2026-03-11T08:00:00Z" })),
  );
});

test("reminderNotification targets an email assignee, untargeted otherwise", () => {
  assert.deepEqual(reminderNotification(task({ title: "Pay", assignee: "sam@demo", dueDate: "2026-03-12" })).target, { email: "sam@demo" });
  assert.deepEqual(reminderNotification(task({ assignee: "Sam" })).target, {});
});

test("runReminderSweep fires each due reminder once (mark-before-notify)", async () => {
  const fired = new Set<string>();
  const notes: string[] = [];
  const tasks = [
    task({ id: "a", title: "A", reminderAt: "2026-03-10T08:00:00Z", assignee: "a@x" }),
    task({ id: "b", title: "B", reminderAt: "2026-03-10T11:00:00Z" }), // future
  ];
  const deps = {
    tasks, nowMs: NOW,
    isFired: (k: string) => fired.has(k),
    markFired: (k: string) => { fired.add(k); },
    notify: (n: { title: string }) => { notes.push(n.title); },
  };
  const r1 = await runReminderSweep(deps);
  assert.deepEqual(r1, { fired: 1, taskIds: ["a"] });
  assert.deepEqual(notes, ["Reminder: A"]);
  // Second sweep: already fired → nothing.
  const r2 = await runReminderSweep(deps);
  assert.equal(r2.fired, 0);
  assert.equal(notes.length, 1);
});
