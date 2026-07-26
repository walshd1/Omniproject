import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRunRate } from "./run-rate";

/**
 * Run-rate / burn projection: straight-line extrapolation from budget + actuals + elapsed fraction,
 * plus the required-run-rate to land on budget. Canonical vector, on/under/over-budget cases, the
 * elapsed-fraction clamp, and the divide-by-zero edges (nothing elapsed, zero budget, timeline
 * complete) that must yield null — never NaN/Infinity — mirroring the EVM engine's discipline.
 */

// Canonical: budget 1000, spent 600 at the halfway mark ⇒ on track to spend 1200 (20% over).
test("canonical vector: halfway, 60% burned, projects 20% over budget", () => {
  const r = computeRunRate({ budget: 1000, actualToDate: 600, elapsedFraction: 0.5 });
  assert.equal(r.runRate, 1200); // 600 / 0.5
  assert.equal(r.projectedAtCompletion, 1200);
  assert.equal(r.variance, 200); // 1200 − 1000
  assert.equal(r.variancePct, 0.2); // 200 / 1000
  assert.equal(r.burnedPct, 0.6); // 600 / 1000
  assert.equal(r.requiredRunRate, 800); // (1000 − 600) / 0.5 — must slow to 800/half to land on budget
});

test("on-budget: spend tracks elapsed exactly ⇒ zero variance, required = current run-rate", () => {
  const r = computeRunRate({ budget: 1000, actualToDate: 250, elapsedFraction: 0.25 });
  assert.equal(r.projectedAtCompletion, 1000);
  assert.equal(r.variance, 0);
  assert.equal(r.variancePct, 0);
  assert.equal(r.requiredRunRate, 1000); // (1000 − 250) / 0.75
});

test("under-budget: burning slower than the clock ⇒ negative variance", () => {
  const r = computeRunRate({ budget: 1000, actualToDate: 300, elapsedFraction: 0.5 });
  assert.equal(r.projectedAtCompletion, 600); // 300 / 0.5
  assert.equal(r.variance, -400);
  assert.equal(r.variancePct, -0.4);
  assert.equal(r.requiredRunRate, 1400); // room to spend faster: (1000 − 300) / 0.5
});

test("clamps elapsedFraction into [0, 1]", () => {
  const over = computeRunRate({ budget: 1000, actualToDate: 900, elapsedFraction: 1.5 });
  assert.equal(over.elapsedFraction, 1); // clamped down
  assert.equal(over.projectedAtCompletion, 900); // 900 / 1
  assert.equal(over.requiredRunRate, null); // remaining fraction is 0 — timeline complete
  const under = computeRunRate({ budget: 1000, actualToDate: 0, elapsedFraction: -0.3 });
  assert.equal(under.elapsedFraction, 0); // clamped up
  assert.equal(under.projectedAtCompletion, null); // nothing elapsed
});

test("nothing elapsed (elapsedFraction 0): projection + variance are null, not Infinity", () => {
  const r = computeRunRate({ budget: 1000, actualToDate: 0, elapsedFraction: 0 });
  assert.equal(r.runRate, null);
  assert.equal(r.projectedAtCompletion, null);
  assert.equal(r.variance, null);
  assert.equal(r.variancePct, null);
  assert.equal(r.burnedPct, 0); // 0 / 1000 is defined
  assert.equal(r.requiredRunRate, 1000); // (1000 − 0) / 1
});

test("zero budget: percentage ratios are null, absolute projection still computes", () => {
  const r = computeRunRate({ budget: 0, actualToDate: 100, elapsedFraction: 0.5 });
  assert.equal(r.projectedAtCompletion, 200); // 100 / 0.5
  assert.equal(r.variance, 200); // 200 − 0
  assert.equal(r.variancePct, null); // divide by 0 budget
  assert.equal(r.burnedPct, null); // divide by 0 budget
  assert.equal(r.requiredRunRate, -200); // (0 − 100) / 0.5 — already overspent
});

test("timeline complete (elapsedFraction 1): requiredRunRate is null, projection = actuals", () => {
  const r = computeRunRate({ budget: 1000, actualToDate: 1100, elapsedFraction: 1 });
  assert.equal(r.projectedAtCompletion, 1100);
  assert.equal(r.variance, 100);
  assert.equal(r.requiredRunRate, null); // no remaining timeline to spread the remaining budget over
});

test("no result field is ever NaN or Infinity across the edge cases", () => {
  const cases = [
    { budget: 0, actualToDate: 0, elapsedFraction: 0 },
    { budget: 0, actualToDate: 0, elapsedFraction: 1 },
    { budget: 1000, actualToDate: 500, elapsedFraction: 0 },
    { budget: -1000, actualToDate: 500, elapsedFraction: 0.5 },
  ];
  for (const c of cases) {
    const r = computeRunRate(c);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === "number") {
        assert.ok(Number.isFinite(v), `${k} must be finite for ${JSON.stringify(c)}, got ${v}`);
      }
    }
  }
});
