import { describe, it, expect } from "vitest";
import { linearScale, niceTicks } from "./scale";

describe("linearScale", () => {
  it("maps the domain endpoints onto the range endpoints", () => {
    const s = linearScale([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
    expect(s(5)).toBe(50);
  });

  it("supports an inverted range (SVG y grows downward)", () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200); // value 0 at the bottom
    expect(y(100)).toBe(0); // max at the top
  });

  it("maps a zero-width domain to the range start (no divide-by-zero)", () => {
    const s = linearScale([5, 5], [0, 100]);
    expect(s(5)).toBe(0);
  });
});

describe("niceTicks", () => {
  it("produces human-round ticks spanning the data", () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(100);
    // Steps are equal and nice (1/2/5 × 10ⁿ → 20s for a 0–100 span at ~5 ticks).
    expect(ticks).toEqual([0, 20, 40, 60, 80, 100]);
  });

  it("covers a non-round max by rounding the top tick up", () => {
    const ticks = niceTicks(0, 92);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(92);
    expect(ticks[0]).toBe(0);
  });

  it("returns a single tick for a degenerate domain", () => {
    expect(niceTicks(7, 7)).toEqual([7]);
    expect(niceTicks(Number.NaN, 10)).toEqual([0]);
  });
});
