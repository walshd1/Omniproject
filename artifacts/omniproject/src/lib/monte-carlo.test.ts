import { describe, it, expect } from "vitest";
import { simulate, mulberry32, type RiskTask } from "./monte-carlo";

/**
 * Monte Carlo risk — stateless, deterministic given a seeded RNG.
 */

const tasks: RiskTask[] = [
  { id: "a", label: "Foundations", estimate: 100 },
  { id: "b", label: "Walls", estimate: 40 },
  { id: "c", label: "Roof", estimate: 20 },
];

function run(opts = {}) {
  return simulate(tasks, { iterations: 4000, uncertainty: 0.3, rng: mulberry32(42), ...opts });
}

describe("simulate", () => {
  it("returns ordered confidence levels within [min, max]", () => {
    const r = run();
    expect(r.min).toBeLessThanOrEqual(r.p10);
    expect(r.p10).toBeLessThanOrEqual(r.p50);
    expect(r.p50).toBeLessThanOrEqual(r.p80);
    expect(r.p80).toBeLessThanOrEqual(r.p90);
    expect(r.p90).toBeLessThanOrEqual(r.max);
  });

  it("shows the naive plan is optimistic: deterministic sum sits below the mean (right-skew)", () => {
    const r = run();
    expect(r.deterministic).toBe(160); // 100+40+20
    expect(r.mean).toBeGreaterThan(r.deterministic);
    // The naive plan is achieved well under half the time.
    expect(r.planConfidence).toBeLessThan(0.5);
  });

  it("ranks the biggest, most-uncertain task as the top variance driver (tornado)", () => {
    const r = run();
    expect(r.sensitivity[0]!.id).toBe("a"); // the 100-unit task dominates
    expect(Math.abs(r.sensitivity[0]!.correlation)).toBeGreaterThan(Math.abs(r.sensitivity[2]!.correlation));
  });

  it("is deterministic for a given seed", () => {
    expect(run().p90).toBe(run().p90);
  });

  it("widens the spread as uncertainty rises", () => {
    const lo = run({ uncertainty: 0.1 });
    const hi = run({ uncertainty: 0.6 });
    expect(hi.p90 - hi.p10).toBeGreaterThan(lo.p90 - lo.p10);
  });

  it("produces a monotonic non-decreasing S-curve from 0 to 1", () => {
    const r = run();
    expect(r.curve[0]!.probability).toBeGreaterThanOrEqual(0);
    expect(r.curve.at(-1)!.probability).toBe(1);
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i]!.probability).toBeGreaterThanOrEqual(r.curve[i - 1]!.probability);
    }
  });

  it("handles an empty / zero-estimate task set without dividing by zero", () => {
    const r = simulate([{ id: "x", label: "x", estimate: 0 }], { rng: mulberry32(1) });
    expect(r.deterministic).toBe(0);
    expect(r.p50).toBe(0);
    expect(r.sensitivity).toEqual([]);
  });
});
