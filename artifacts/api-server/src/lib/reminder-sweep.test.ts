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

// An atomic set-if-absent store shared by all sweeps (models sharedKv.cas).
function claimStore() {
  const fired = new Set<string>();
  return {
    isFired: (k: string) => fired.has(k),
    claim: (k: string) => { if (fired.has(k)) return false; fired.add(k); return true; }, // won iff absent
  };
}

test("runReminderSweep delivers each due reminder once (atomic claim)", async () => {
  const store = claimStore();
  const notes: string[] = [];
  const tasks = [
    task({ id: "a", title: "A", reminderAt: "2026-03-10T08:00:00Z", assignee: "a@x" }),
    task({ id: "b", title: "B", reminderAt: "2026-03-10T11:00:00Z" }), // future
  ];
  const deps = { tasks, nowMs: NOW, ...store, notify: (n: { title: string }) => { notes.push(n.title); } };
  const r1 = await runReminderSweep(deps);
  assert.deepEqual(r1, { fired: 1, taskIds: ["a"] });
  assert.deepEqual(notes, ["Reminder: A"]);
  // Second sweep: already claimed → nothing.
  const r2 = await runReminderSweep(deps);
  assert.equal(r2.fired, 0);
  assert.equal(notes.length, 1);
});

test("overlapping sweeps sharing an atomic store deliver a reminder exactly once (no double-fire)", async () => {
  const store = claimStore();
  const notes: string[] = [];
  const tasks = [task({ id: "a", title: "A", reminderAt: "2026-03-10T08:00:00Z", assignee: "a@x" })];
  const deps = { tasks, nowMs: NOW, ...store, notify: (n: { title: string }) => { notes.push(n.title); } };
  // Two sweeps run "concurrently" over the SAME claim store (e.g. two replicas / an overlapping cron).
  const [r1, r2] = await Promise.all([runReminderSweep(deps), runReminderSweep(deps)]);
  assert.equal(r1.fired + r2.fired, 1); // exactly one sweep delivered
  assert.deepEqual(notes, ["Reminder: A"]);
});
