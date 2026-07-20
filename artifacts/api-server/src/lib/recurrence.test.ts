import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, isRecurring } from "./recurrence";

/** The pure recurring-task next-occurrence computer (Todoist-style rules + RRULE-lite). */

test("simple intervals: daily / weekly / monthly / yearly", () => {
  assert.equal(nextOccurrence("every day", "2026-01-10"), "2026-01-11");
  assert.equal(nextOccurrence("daily", "2026-01-10"), "2026-01-11");
  assert.equal(nextOccurrence("every week", "2026-01-10"), "2026-01-17");
  assert.equal(nextOccurrence("weekly", "2026-01-10"), "2026-01-17");
  assert.equal(nextOccurrence("every month", "2026-01-10"), "2026-02-10");
  assert.equal(nextOccurrence("yearly", "2026-01-10"), "2027-01-10");
});

test("every N units", () => {
  assert.equal(nextOccurrence("every 2 weeks", "2026-01-10"), "2026-01-24");
  assert.equal(nextOccurrence("every 3 days", "2026-01-10"), "2026-01-13");
  assert.equal(nextOccurrence("every 6 months", "2026-01-10"), "2026-07-10");
});

test("month/year arithmetic clamps the day-of-month", () => {
  assert.equal(nextOccurrence("every month", "2026-01-31"), "2026-02-28"); // Feb 2026 has 28 days
  assert.equal(nextOccurrence("every year", "2024-02-29"), "2025-02-28");  // leap → non-leap
});

test("every weekday (Mon–Fri) skips the weekend", () => {
  assert.equal(nextOccurrence("every weekday", "2026-01-09"), "2026-01-12"); // Fri → Mon
  assert.equal(nextOccurrence("every weekday", "2026-01-12"), "2026-01-13"); // Mon → Tue
});

test("every <weekday-name> lands on the next such day (strictly after)", () => {
  assert.equal(nextOccurrence("every monday", "2026-01-12"), "2026-01-19"); // Mon → next Mon
  assert.equal(nextOccurrence("every friday", "2026-01-12"), "2026-01-16"); // Mon → Fri
});

test("RRULE-lite FREQ + INTERVAL", () => {
  assert.equal(nextOccurrence("FREQ=WEEKLY;INTERVAL=2", "2026-01-10"), "2026-01-24");
  assert.equal(nextOccurrence("FREQ=DAILY", "2026-01-10"), "2026-01-11");
  assert.equal(nextOccurrence("FREQ=MONTHLY;INTERVAL=3", "2026-01-10"), "2026-04-10");
});

test("one-off / unparseable / missing → null", () => {
  assert.equal(nextOccurrence(null, "2026-01-10"), null);
  assert.equal(nextOccurrence("", "2026-01-10"), null);
  assert.equal(nextOccurrence("someday maybe", "2026-01-10"), null);
  assert.equal(nextOccurrence("every day", ""), null); // no reference date
});

test("isRecurring reflects parseability", () => {
  assert.equal(isRecurring("every 2 weeks"), true);
  assert.equal(isRecurring("every weekday"), true);
  assert.equal(isRecurring("whenever"), false);
  assert.equal(isRecurring(null), false);
});
