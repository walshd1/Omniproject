import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { stepUpFresh, stepUpWindowMs } from "./step-up";

/**
 * Step-up freshness window: a sensitive action requires a recent re-auth stamp.
 */
afterEach(() => { delete process.env["STEP_UP_MINUTES"]; });

test("a session with no step-up is never fresh", () => {
  assert.equal(stepUpFresh(null, Date.now()), false);
  assert.equal(stepUpFresh({}, Date.now()), false);
});

test("a recent step-up is fresh; a stale one is not", () => {
  const now = 1_000_000;
  assert.equal(stepUpFresh({ stepUpAt: now - 60_000 }, now), true); // 1 min ago, within 5
  assert.equal(stepUpFresh({ stepUpAt: now - 6 * 60_000 }, now), false); // 6 min ago, past 5
});

test("the window is configurable via STEP_UP_MINUTES", () => {
  process.env["STEP_UP_MINUTES"] = "1";
  assert.equal(stepUpWindowMs(), 60_000);
  const now = 1_000_000;
  assert.equal(stepUpFresh({ stepUpAt: now - 90_000 }, now), false); // 90s ago, past 1 min
});

test("a bad STEP_UP_MINUTES falls back to the 5-minute default", () => {
  process.env["STEP_UP_MINUTES"] = "nonsense";
  assert.equal(stepUpWindowMs(), 5 * 60_000);
});
