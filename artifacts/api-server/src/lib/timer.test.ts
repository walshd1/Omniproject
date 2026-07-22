import { test } from "node:test";
import assert from "node:assert/strict";
import { runningTimerKey, sanitizeTimerStart, elapsedHours, timerToEntry, TimerError } from "./timer";

/** The live-timer pure helpers: key, sanitise, elapsed-hours, and materialising a timesheet entry. */

test("runningTimerKey is per-user", () => {
  assert.equal(runningTimerKey("u1"), "timer:running:u1");
});

test("sanitizeTimerStart requires a projectId and keeps optional issue/note", () => {
  const t = sanitizeTimerStart({ projectId: " P1 ", issueId: "OMNI-1", note: "  design  " }, "2026-01-01T09:00:00Z");
  assert.equal(t.projectId, "P1");
  assert.equal(t.issueId, "OMNI-1");
  assert.equal(t.note, "design");
  assert.equal(t.startedAt, "2026-01-01T09:00:00Z");
  assert.throws(() => sanitizeTimerStart({}, "2026-01-01T09:00:00Z"), (e) => e instanceof TimerError);
});

test("elapsedHours rounds to 2dp and never goes negative", () => {
  const start = "2026-01-01T09:00:00Z";
  assert.equal(elapsedHours(start, Date.parse("2026-01-01T10:30:00Z")), 1.5);
  assert.equal(elapsedHours(start, Date.parse("2026-01-01T09:15:00Z")), 0.25);
  assert.equal(elapsedHours(start, Date.parse("2026-01-01T08:00:00Z")), 0); // clock skew ⇒ 0
  assert.equal(elapsedHours("not-a-date", Date.now()), 0);
});

test("timerToEntry produces a day-grained timesheet entry", () => {
  const t = sanitizeTimerStart({ projectId: "P1", issueId: "OMNI-1", note: "build" }, "2026-01-01T09:00:00Z");
  const entry = timerToEntry(t, Date.parse("2026-01-01T11:00:00Z"), "2026-01-01");
  assert.deepEqual(entry, { projectId: "P1", issueId: "OMNI-1", date: "2026-01-01", hours: 2, note: "build" });
});
