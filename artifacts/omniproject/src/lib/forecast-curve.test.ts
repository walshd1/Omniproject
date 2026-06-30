import { describe, it, expect } from "vitest";
import { spreadWeights, monthBuckets, timePhasedForecast, scheduleWindow } from "./forecast-curve";

const D = (s: string) => Date.parse(s);

describe("spreadWeights", () => {
  it("every profile sums to 1", () => {
    for (const p of ["scurve", "linear", "frontLoaded", "backLoaded"] as const) {
      const w = spreadWeights(p, 7);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
  });

  it("linear is flat; front-loaded front-weights; back-loaded back-weights; s-curve peaks in the middle", () => {
    const lin = spreadWeights("linear", 4);
    expect(lin.every((w) => Math.abs(w - 0.25) < 1e-12)).toBe(true);
    const front = spreadWeights("frontLoaded", 4);
    expect(front[0]!).toBeGreaterThan(front[3]!);
    const back = spreadWeights("backLoaded", 4);
    expect(back[3]!).toBeGreaterThan(back[0]!);
    const s = spreadWeights("scurve", 5);
    expect(s[2]!).toBeGreaterThan(s[0]!);
    expect(s[2]!).toBeGreaterThan(s[4]!);
  });

  it("degenerate sizes", () => {
    expect(spreadWeights("scurve", 1)).toEqual([1]);
    expect(spreadWeights("linear", 0)).toEqual([]);
  });
});

describe("monthBuckets", () => {
  it("is inclusive of both end months", () => {
    const b = monthBuckets(D("2026-01-15"), D("2026-04-03"));
    expect(b.map((m) => new Date(m).getUTCMonth())).toEqual([0, 1, 2, 3]); // Jan..Apr
  });
  it("caps run-away windows", () => {
    expect(monthBuckets(D("2000-01-01"), D("2100-01-01")).length).toBeLessThanOrEqual(36);
  });
  it("never empty even when end precedes start", () => {
    expect(monthBuckets(D("2026-06-01"), D("2026-01-01")).length).toBe(1);
  });
});

describe("scheduleWindow", () => {
  const now = D("2026-03-15");
  it("spans the earliest start to the latest due", () => {
    const w = scheduleWindow([{ startDate: "2026-01-10", dueDate: "2026-02-01" }, { startDate: "2026-04-01", dueDate: "2026-06-30" }], now)!;
    expect(w.start).toBe(D("2026-01-10"));
    expect(w.end).toBe(D("2026-06-30"));
  });
  it("always contains today even if dates are all in the past", () => {
    const w = scheduleWindow([{ startDate: "2025-01-01", dueDate: "2025-03-01" }], now)!;
    expect(w.end).toBe(now);
  });
  it("returns null when no item carries a date", () => {
    expect(scheduleWindow([{ startDate: null, dueDate: null }, {}], now)).toBeNull();
  });
});

describe("timePhasedForecast", () => {
  const base = { bac: 1200, eac: 1200, actualToDate: 600, start: D("2026-01-01"), end: D("2026-06-30"), profile: "linear" as const };

  it("planned ends at BAC and forecast ends at EAC", () => {
    const c = timePhasedForecast({ ...base, asOf: D("2026-03-20") });
    const last = c.periods[c.periods.length - 1]!;
    expect(last.planned).toBeCloseTo(1200, 6);
    expect(last.forecast).toBeCloseTo(1200, 6);
  });

  it("actuals stop at today, forecast starts at today, and they meet", () => {
    const c = timePhasedForecast({ ...base, asOf: D("2026-03-20") }); // month index 2 of Jan..Jun
    expect(c.nowIndex).toBe(2);
    const now = c.periods[c.nowIndex]!;
    // continuity: at the current period actual == forecast == actualToDate
    expect(now.actual).toBeCloseTo(600, 6);
    expect(now.forecast).toBeCloseTo(600, 6);
    expect(c.periods[c.nowIndex + 1]!.actual).toBeNull();
    expect(c.periods[c.nowIndex - 1]!.forecast).toBeNull();
  });

  it("overspend forecast (EAC > BAC) yields negative VAC and a forecast above planned at completion", () => {
    const c = timePhasedForecast({ ...base, eac: 1500, asOf: D("2026-03-20") });
    expect(c.vac).toBe(-300);
    const last = c.periods[c.periods.length - 1]!;
    expect(last.forecast!).toBeGreaterThan(last.planned);
  });

  it("plannedToDate reflects the schedule baseline at today", () => {
    // linear over 6 months, today in month 3 (index 2) → 3/6 of BAC planned by end of current period
    const c = timePhasedForecast({ ...base, asOf: D("2026-03-20") });
    expect(c.plannedToDate).toBeCloseTo(600, 6);
  });

  it("a window entirely in the past collapses the forecast to EAC at the last period", () => {
    const c = timePhasedForecast({ ...base, eac: 1300, asOf: D("2027-01-01") });
    expect(c.nowIndex).toBe(c.periods.length - 1);
    const last = c.periods[c.periods.length - 1]!;
    expect(last.forecast).toBeCloseTo(1300, 6);
  });
});
