import { test } from "node:test";
import assert from "node:assert/strict";
import {
  withAvailabilityScope, recordAttempted, recordUnavailable,
  readsWereComplete, availabilityReport, currentAvailability,
} from "./read-availability";
import { poolSettle, settledValues } from "./concurrency-pool";

/** The scope is AsyncLocalStorage-based, so run each case inside its own. */
function inScope<T>(fn: () => T): T {
  let out!: T;
  withAvailabilityScope(() => { out = fn(); });
  return out;
}

test("a scope with no failures reports complete", () => {
  const r = inScope(() => { recordAttempted(4); return availabilityReport(); });
  assert.equal(r.complete, true);
  assert.equal(r.attempted, 4);
  assert.equal(r.answered, 4);
  assert.deepEqual(r.unavailable, []);
});

test("one unavailable source makes the read incomplete and is named", () => {
  const r = inScope(() => {
    recordAttempted(4);
    recordUnavailable("project:p-3", "financials read failed");
    return availabilityReport();
  });
  assert.equal(r.complete, false);
  assert.equal(r.answered, 3, "3 of 4 answered");
  assert.deepEqual(r.unavailable, [{ source: "project:p-3", reason: "financials read failed" }]);
});

test("the same source failing repeatedly is ONE outage, not many", () => {
  // A single unreachable backend fails every per-project read in a fan-out. Counting each would
  // report "20 sources unavailable" for one dead system and make the header meaningless.
  const r = inScope(() => {
    recordAttempted(3);
    for (let i = 0; i < 20; i++) recordUnavailable("backend:sap", "connect timeout");
    return availabilityReport();
  });
  assert.equal(r.unavailable.length, 1);
});

test("readsWereComplete is the aggregate veto", () => {
  assert.equal(inScope(() => { recordAttempted(2); return readsWereComplete(); }), true);
  assert.equal(inScope(() => { recordUnavailable("x", "down"); return readsWereComplete(); }), false);
});

test("OUTSIDE a scope nothing throws and aggregates are not suppressed", () => {
  // A caller with no tally has no evidence of a gap. Suppressing every total there would break
  // non-request callers (scheduled exports, tests) far worse than the status quo.
  assert.doesNotThrow(() => { recordAttempted(1); recordUnavailable("x", "y"); });
  assert.equal(readsWereComplete(), true);
  assert.equal(currentAvailability(), undefined);
  assert.deepEqual(availabilityReport(), { complete: true, attempted: 0, answered: 0, unavailable: [] });
});

test("the tally does not leak between scopes", () => {
  inScope(() => { recordAttempted(9); recordUnavailable("leaky", "down"); });
  const second = inScope(() => availabilityReport());
  assert.deepEqual(second, { complete: true, attempted: 0, answered: 0, unavailable: [] });
});

test("poolSettle serves the slice that answered instead of losing everything", async () => {
  // The whole point: Promise.all loses all 4 when one rejects; this keeps the 3 that worked.
  const settled = await poolSettle([1, 2, 3, 4], 2, async (n) => {
    if (n === 3) throw new Error("backend down");
    return n * 10;
  });
  assert.deepEqual(settledValues(settled), [10, 20, 40]);
  const failed = settled.filter((s) => !s.ok);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.item, 3, "the failing item is identified, so the caller can name the source");
});

test("poolSettle preserves input order and never rejects", async () => {
  const settled = await poolSettle([0, 1, 2, 3, 4, 5], 3, async (n) => {
    if (n % 2 === 0) throw new Error("even fails");
    return n;
  });
  assert.deepEqual(settled.map((s) => s.index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(settledValues(settled), [1, 3, 5]);
});
