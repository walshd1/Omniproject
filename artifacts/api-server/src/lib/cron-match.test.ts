import test from "node:test";
import assert from "node:assert/strict";
import { cronMatches, parseCron, cronMinutesInWindow, isValidCron, CronError } from "./cron-match";

const at = (iso: string) => new Date(iso);

test("monthly cron '0 0 1 * *' matches only the 1st at 00:00 UTC", () => {
  assert.equal(cronMatches("0 0 1 * *", at("2024-03-01T00:00:00Z")), true);
  assert.equal(cronMatches("0 0 1 * *", at("2024-03-01T00:01:00Z")), false); // wrong minute
  assert.equal(cronMatches("0 0 1 * *", at("2024-03-02T00:00:00Z")), false); // wrong day
});

test("step, range and list fields", () => {
  for (const m of [0, 15, 30, 45]) assert.equal(cronMatches("*/15 * * * *", at(`2024-03-01T10:${String(m).padStart(2, "0")}:00Z`)), true);
  assert.equal(cronMatches("*/15 * * * *", at("2024-03-01T10:07:00Z")), false);
  assert.equal(cronMatches("0 9-17 * * *", at("2024-03-01T12:00:00Z")), true); // within business hours
  assert.equal(cronMatches("0 9-17 * * *", at("2024-03-01T18:00:00Z")), false);
  assert.equal(cronMatches("0 0 * * 1,3,5", at("2024-03-01T00:00:00Z")), true); // 2024-03-01 is a Friday (dow 5)
});

test("day-of-month and day-of-week are OR'd when both are restricted", () => {
  // Fires on the 1st OR any Monday. 2024-03-04 is a Monday (not the 1st) — should still fire.
  assert.equal(cronMatches("0 0 1 * 1", at("2024-03-04T00:00:00Z")), true); // Monday
  assert.equal(cronMatches("0 0 1 * 1", at("2024-03-01T00:00:00Z")), true); // the 1st (a Friday)
  assert.equal(cronMatches("0 0 1 * 1", at("2024-03-05T00:00:00Z")), false); // Tuesday, not the 1st
});

test("malformed cron throws / isValidCron reports", () => {
  assert.throws(() => parseCron("0 0 1 *"), CronError); // 4 fields
  assert.throws(() => parseCron("60 0 1 * *"), CronError); // minute out of range
  assert.equal(isValidCron("0 0 1 * *"), true);
  assert.equal(isValidCron("not a cron"), false);
});

test("cronMinutesInWindow returns each firing minute in (after, through], bounded", () => {
  // Top of every hour, across a 3-hour window ⇒ 3 firings.
  const after = Date.parse("2024-03-01T09:00:00Z");
  const through = Date.parse("2024-03-01T12:00:00Z");
  const mins = cronMinutesInWindow("0 * * * *", after, through);
  assert.deepEqual(mins.map((d) => d.toISOString()), ["2024-03-01T10:00:00.000Z", "2024-03-01T11:00:00.000Z", "2024-03-01T12:00:00.000Z"]);
  // The lower bound is exclusive: a firing exactly at `after` is not re-returned.
  assert.equal(cronMinutesInWindow("0 * * * *", Date.parse("2024-03-01T10:00:00Z"), Date.parse("2024-03-01T10:00:00Z")).length, 0);
  // Bounded: a huge window is capped by maxMinutes (no unbounded scan).
  assert.ok(cronMinutesInWindow("* * * * *", 0, Date.parse("2024-03-01T00:00:00Z"), 10).length <= 10);
});
