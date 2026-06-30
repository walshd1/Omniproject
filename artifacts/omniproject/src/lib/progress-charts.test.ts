import { describe, it, expect } from "vitest";
import {
  burndownSeries,
  burnupSeries,
  cumulativeFlowSeries,
  velocitySeries,
  meanVelocity,
  type HistoryPoint,
} from "./progress-charts";

const H: HistoryPoint[] = [
  { date: "2026-06-01", totalIssues: 10, completedIssues: 0 },
  { date: "2026-06-08", totalIssues: 10, completedIssues: 3 },
  { date: "2026-06-15", totalIssues: 12, completedIssues: 7 }, // scope grew by 2
  { date: "2026-06-22", totalIssues: 12, completedIssues: 12 },
];

describe("burndownSeries", () => {
  it("tracks remaining work and a straight ideal line down to zero", () => {
    const s = burndownSeries(H);
    expect(s.map((p) => p.remaining)).toEqual([10, 7, 5, 0]);
    expect(s[0]!.ideal).toBe(10); // starts at the initial remaining
    expect(s.at(-1)!.ideal).toBe(0); // ends at zero
  });
  it("is empty for no history and flat-ideal for a single sample", () => {
    expect(burndownSeries([])).toEqual([]);
    const one = burndownSeries([{ date: "d", totalIssues: 4, completedIssues: 1 }]);
    expect(one).toEqual([{ date: "d", remaining: 3, ideal: 3 }]);
  });
});

describe("burnupSeries", () => {
  it("rises completed toward the (moving) scope line", () => {
    const s = burnupSeries(H);
    expect(s.map((p) => p.completed)).toEqual([0, 3, 7, 12]);
    expect(s.map((p) => p.scope)).toEqual([10, 10, 12, 12]); // scope change is visible
  });
});

describe("cumulativeFlowSeries", () => {
  it("splits each sample into completed + remaining bands", () => {
    const s = cumulativeFlowSeries(H);
    expect(s[2]).toEqual({ date: "2026-06-15", completed: 7, remaining: 5 });
  });
});

describe("velocitySeries", () => {
  it("is the per-period positive delta of completed work", () => {
    const s = velocitySeries(H);
    expect(s.map((p) => p.completed)).toEqual([3, 4, 5]);
    expect(meanVelocity(s)).toBe(4);
  });
  it("clamps re-opened work (negative delta) to zero and needs ≥2 samples", () => {
    expect(velocitySeries([H[0]!])).toEqual([]);
    const reopened = velocitySeries([
      { date: "a", totalIssues: 5, completedIssues: 4 },
      { date: "b", totalIssues: 5, completedIssues: 2 },
    ]);
    expect(reopened).toEqual([{ period: "b", completed: 0 }]);
  });
});
