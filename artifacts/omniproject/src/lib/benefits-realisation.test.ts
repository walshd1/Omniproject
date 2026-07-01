import { describe, it, expect } from "vitest";
import { realisationPipeline, realisationSchedule } from "./benefits-realisation";
import type { ProjectItems } from "./portfolio-value";

const D = (s: string) => Date.parse(s);

/** A project of benefit-bearing work items. Currency defaults to GBP (no conversion). */
function project(items: Array<{ plannedBenefitValue?: number; actualBenefitValue?: number; benefitStatus?: string; benefitDueDate?: string }>, over: Partial<ProjectItems> = {}): ProjectItems {
  return {
    projectId: "p", projectName: "P", programmeId: null, programmeName: null, currency: "GBP",
    items: items.map((it, i) => ({ id: `b${i}`, title: `B${i}`, ...it })),
    ...over,
  } as ProjectItems;
}

describe("realisationPipeline", () => {
  const projects = [
    project([
      { plannedBenefitValue: 100, actualBenefitValue: 100, benefitStatus: "realised" },
      { plannedBenefitValue: 200, actualBenefitValue: 50, benefitStatus: "on track" },
      { plannedBenefitValue: 300, actualBenefitValue: 0, benefitStatus: "at risk" },
      { plannedBenefitValue: 150, actualBenefitValue: 0, benefitStatus: "missed" },
    ]),
  ];

  it("buckets planned+actual value by lifecycle stage in board order", () => {
    const p = realisationPipeline(projects, "GBP");
    expect(p.buckets.map((b) => b.bucket)).toEqual(["realised", "on_track", "at_risk", "missed", "not_started"]);
    expect(p.buckets.find((b) => b.bucket === "realised")!.planned).toBe(100);
    expect(p.buckets.find((b) => b.bucket === "at_risk")!.planned).toBe(300);
  });

  it("totals, at-risk value (at_risk+missed) and realisation %", () => {
    const p = realisationPipeline(projects, "GBP");
    expect(p.totalPlanned).toBe(750);
    expect(p.totalActual).toBe(150);
    expect(p.atRiskValue).toBe(450); // 300 at risk + 150 missed
    expect(p.realisationPct).toBe(20); // 150 / 750
  });

  it("converts into the reporting currency", () => {
    const usd = [project([{ plannedBenefitValue: 100, actualBenefitValue: 100, benefitStatus: "realised" }], { currency: "USD" })];
    const p = realisationPipeline(usd, "GBP", { GBP: 1, USD: 0.5 }); // convertAmount: amount × rFrom ÷ rTo
    expect(p.totalPlanned).toBe(50);
  });

  it("empty portfolio is zeroed", () => {
    const p = realisationPipeline([project([])], "GBP");
    expect(p.totalPlanned).toBe(0);
    expect(p.realisationPct).toBe(0);
  });
});

describe("realisationSchedule", () => {
  const now = D("2026-05-15");
  const projects = [
    project([
      { plannedBenefitValue: 100, actualBenefitValue: 90, benefitStatus: "realised", benefitDueDate: "2026-02-10" }, // Q1
      { plannedBenefitValue: 200, actualBenefitValue: 40, benefitStatus: "at risk", benefitDueDate: "2026-05-01" }, // Q2 (past)
      { plannedBenefitValue: 300, actualBenefitValue: 0, benefitStatus: "on track", benefitDueDate: "2026-11-01" }, // Q4 (future)
      { plannedBenefitValue: 50, actualBenefitValue: 0 }, // undated
    ]),
  ];

  it("buckets planned value by due quarter with a contiguous cumulative curve", () => {
    const s = realisationSchedule(projects, "GBP", undefined, now);
    expect(s.periods.map((p) => p.label)).toEqual(["Q1 26", "Q2 26", "Q3 26", "Q4 26"]);
    expect(s.periods[0]!.plannedDue).toBe(100);
    expect(s.periods[3]!.cumulativePlanned).toBe(600); // 100+200+0+300
  });

  it("realised line stops at today (future quarters are null)", () => {
    const s = realisationSchedule(projects, "GBP", undefined, now);
    expect(s.periods[1]!.cumulativeRealised).toBe(130); // 90 + 40 by Q2
    expect(s.periods[3]!.cumulativeRealised).toBeNull(); // Q4 is in the future
  });

  it("computes to-date planned/realised, shortfall and overdue-unrealised", () => {
    const s = realisationSchedule(projects, "GBP", undefined, now);
    expect(s.plannedToDate).toBe(300); // 100 (Q1) + 200 (Q2), both due by now
    expect(s.realisedToDate).toBe(130);
    expect(s.shortfallToDate).toBe(170);
    expect(s.overdueUnrealised).toBe(170); // (100-90) + (200-40)
    expect(s.undated).toBe(50);
  });

  it("no dated benefits → empty schedule but still reports undated value", () => {
    const s = realisationSchedule([project([{ plannedBenefitValue: 80, benefitStatus: "on track" }])], "GBP", undefined, now);
    expect(s.periods).toEqual([]);
    expect(s.undated).toBe(80);
    expect(s.totalPlanned).toBe(80);
  });
});
