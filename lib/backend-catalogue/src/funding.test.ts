import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFunding, rollupFunding } from "./funding";

/**
 * Funding-envelope / scenario engine: an approved envelope against committed + forecast draw. Canonical
 * vector, the over-committed case, the optional commit-pacing outputs, the divide-by-zero edges (zero
 * envelope ⇒ null percentages, zero plan ⇒ null burn-through) that must yield null — never NaN/Infinity —
 * dirty-input coercion, and the portfolio-scale roll-up. Mirrors the run-rate engine's discipline.
 */

// Canonical: envelope 1000 fully covers a 400 committed + 400 forecast plan, with 200 (20%) headroom.
test("canonical vector: 20% headroom, not over-committed, envelope covers the whole plan", () => {
  const r = computeFunding({ envelope: 1000, committed: 400, forecast: 400 });
  assert.equal(r.projectedTotal, 800);
  assert.equal(r.headroom, 200);
  assert.equal(r.headroomPct, 0.2);
  assert.equal(r.committedPct, 0.4);
  assert.equal(r.forecastPct, 0.4);
  assert.equal(r.overCommitted, false);
  assert.equal(r.burnThroughFraction, 1); // envelope/plan = 1.25, clamped to 1 (fully funded)
  // No elapsed fraction supplied ⇒ pacing outputs are null.
  assert.equal(r.elapsedFraction, null);
  assert.equal(r.expectedCommitted, null);
  assert.equal(r.paceVariance, null);
});

test("over-committed: the plan exceeds the envelope ⇒ negative headroom, overCommitted, burn-through < 1", () => {
  const r = computeFunding({ envelope: 1000, committed: 700, forecast: 500 });
  assert.equal(r.projectedTotal, 1200);
  assert.equal(r.headroom, -200);
  assert.equal(r.headroomPct, -0.2);
  assert.equal(r.overCommitted, true);
  assert.equal(r.burnThroughFraction, 0.8333); // 1000/1200 — the money covers 83% of the plan
});

test("commit pacing: expected-by-now + variance, with the elapsed fraction clamped to [0,1]", () => {
  const r = computeFunding({ envelope: 1000, committed: 600, forecast: 300, elapsedFraction: 0.5 });
  assert.equal(r.elapsedFraction, 0.5);
  assert.equal(r.expectedCommitted, 500); // 1000 × 0.5
  assert.equal(r.paceVariance, 100); // 600 committed − 500 expected ⇒ ahead of the straight-line pace
  // Out-of-range elapsed clamps into [0,1].
  const over = computeFunding({ envelope: 1000, committed: 400, forecast: 0, elapsedFraction: 1.5 });
  assert.equal(over.elapsedFraction, 1);
  assert.equal(over.expectedCommitted, 1000);
  assert.equal(over.paceVariance, -600);
});

test("zero envelope ⇒ null percentages (never NaN), but money + over-commit still read", () => {
  const r = computeFunding({ envelope: 0, committed: 100, forecast: 50 });
  assert.equal(r.headroom, -150);
  assert.equal(r.headroomPct, null);
  assert.equal(r.committedPct, null);
  assert.equal(r.forecastPct, null);
  assert.equal(r.overCommitted, true); // any plan over a zero envelope is over-committed
  assert.equal(r.burnThroughFraction, 0); // 0/150 — a zero envelope funds none of the plan
});

test("nothing planned yet ⇒ burn-through is null (no divide by zero)", () => {
  const r = computeFunding({ envelope: 500, committed: 0, forecast: 0 });
  assert.equal(r.projectedTotal, 0);
  assert.equal(r.burnThroughFraction, null);
  assert.equal(r.headroom, 500);
  assert.equal(r.headroomPct, 1);
  assert.equal(r.overCommitted, false);
});

test("dirty inputs are coerced to finite numbers (a NaN/undefined can't poison a sum)", () => {
  const r = computeFunding({ envelope: 1000, committed: NaN, forecast: Infinity } as unknown as { envelope: number; committed: number; forecast: number });
  assert.equal(r.committed, 0);
  assert.equal(r.forecast, 0);
  assert.equal(r.headroom, 1000);
  assert.equal(r.burnThroughFraction, null); // projectedTotal coerced to 0
});

test("roll-up: sums the envelopes and recomputes headroom / over-commit / burn-through at scale", () => {
  const r = rollupFunding([
    { envelope: 1000, committed: 400, forecast: 400 },
    { envelope: 500, committed: 300, forecast: 300 },
  ]);
  assert.equal(r.count, 2);
  assert.equal(r.envelope, 1500);
  assert.equal(r.committed, 700);
  assert.equal(r.forecast, 700);
  assert.equal(r.projectedTotal, 1400);
  assert.equal(r.headroom, 100); // 1500 − 1400
  assert.equal(r.headroomPct, 0.0667); // 100/1500
  assert.equal(r.overCommitted, false);
  assert.equal(r.burnThroughFraction, 1); // 1500/1400 clamped to 1
});

test("empty roll-up ⇒ zero count + money, null ratios (no divide by zero)", () => {
  const r = rollupFunding([]);
  assert.equal(r.count, 0);
  assert.equal(r.envelope, 0);
  assert.equal(r.headroom, 0);
  assert.equal(r.headroomPct, null);
  assert.equal(r.burnThroughFraction, null);
  assert.equal(r.overCommitted, false);
});
