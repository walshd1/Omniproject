import { describe, it, expect } from "vitest";
import type { Project, PortfolioHealthSummary } from "@workspace/api-client-react";
import { applyScenario, summarize, diffSummary } from "./scenario";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 10, completedCount: 5, memberCount: 1, updatedAt: "" },
  { id: "p2", name: "Beta", identifier: "BE", source: "jira", issueCount: 4, completedCount: 4, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

const portfolio = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "RED", scheduleVarianceDays: -4, budgetVariancePercentage: 8, activeBlockersCount: 2 },
  { projectId: "p2", projectName: "Beta", ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: -3, activeBlockersCount: 1 },
] as unknown as PortfolioHealthSummary[];

describe("applyScenario", () => {
  it("does not mutate the inputs", () => {
    const projSnapshot = JSON.stringify(projects);
    const portSnapshot = JSON.stringify(portfolio);
    applyScenario(projects, portfolio, {
      p1: { completionDeltaPct: 20, scheduleDeltaDays: -2, budgetDeltaPct: 5, blockersDelta: 3 },
    });
    expect(JSON.stringify(projects)).toBe(projSnapshot);
    expect(JSON.stringify(portfolio)).toBe(portSnapshot);
  });

  it("applies completionDeltaPct via completedCount", () => {
    // p1: base 50% (5/10), +20pts -> 70% -> 7 completed.
    const { projects: out } = applyScenario(projects, portfolio, { p1: { completionDeltaPct: 20 } });
    expect(out.find((p) => p.id === "p1")!.completedCount).toBe(7);
  });

  it("clamps completedCount within [0, issueCount]", () => {
    const up = applyScenario(projects, portfolio, { p1: { completionDeltaPct: 999 } });
    expect(up.projects.find((p) => p.id === "p1")!.completedCount).toBe(10);
    const down = applyScenario(projects, portfolio, { p1: { completionDeltaPct: -999 } });
    expect(down.projects.find((p) => p.id === "p1")!.completedCount).toBe(0);
  });

  it("clamps blockers at >= 0 and adds variance deltas", () => {
    const { portfolio: out } = applyScenario(projects, portfolio, {
      p1: { blockersDelta: -10, scheduleDeltaDays: -3, budgetDeltaPct: 4 },
    });
    const row = out.find((r) => r.projectId === "p1")!;
    expect(row.activeBlockersCount).toBe(0);
    expect(row.scheduleVarianceDays).toBe(-7);
    expect(row.budgetVariancePercentage).toBe(12);
  });

  it("leaves projects without an adjustment untouched (copied)", () => {
    const { projects: out } = applyScenario(projects, portfolio, { p1: { completionDeltaPct: 10 } });
    const p2 = out.find((p) => p.id === "p2")!;
    expect(p2.completedCount).toBe(4);
    expect(p2).not.toBe(projects[1]);
  });
});

describe("summarize", () => {
  it("computes completion as Σcompleted/Σissues*100", () => {
    // (5+4)/(10+4) = 9/14 = 64.3%
    expect(summarize(projects, portfolio).completionPct).toBe(64.3);
  });

  it("guards divide-by-zero with empty/zero issues", () => {
    expect(summarize([], []).completionPct).toBe(0);
    const zero = [{ id: "z", issueCount: 0, completedCount: 0 }] as unknown as Project[];
    expect(summarize(zero, []).completionPct).toBe(0);
  });

  it("averages variances and totals blockers", () => {
    const s = summarize(projects, portfolio);
    expect(s.avgScheduleVarianceDays).toBe(-1); // (-4+2)/2
    expect(s.avgBudgetVariancePct).toBe(2.5); // (8-3)/2
    expect(s.totalBlockers).toBe(3);
  });

  it("counts RAG statuses", () => {
    expect(summarize(projects, portfolio).ragCounts).toEqual({ RED: 1, AMBER: 0, GREEN: 1 });
  });

  it("returns zeroed averages for empty portfolio", () => {
    const s = summarize(projects, []);
    expect(s.avgScheduleVarianceDays).toBe(0);
    expect(s.avgBudgetVariancePct).toBe(0);
    expect(s.totalBlockers).toBe(0);
    expect(s.ragCounts).toEqual({ RED: 0, AMBER: 0, GREEN: 0 });
  });
});

describe("diffSummary", () => {
  it("reports scenario − base per metric", () => {
    const base = summarize(projects, portfolio);
    const { projects: sp, portfolio: spo } = applyScenario(projects, portfolio, {
      p1: { completionDeltaPct: 30, scheduleDeltaDays: 4, budgetDeltaPct: 2, blockersDelta: 1 },
    });
    const scen = summarize(sp, spo);
    const d = diffSummary(base, scen);
    // p1 5->8 completed: (8+4)/14 = 85.7% vs 64.3% => +21.4
    expect(d.completionPct).toBe(21.4);
    expect(d.avgScheduleVarianceDays).toBe(2); // avg shifts by +4/2
    expect(d.avgBudgetVariancePct).toBe(1); // +2/2
    expect(d.totalBlockers).toBe(1);
  });

  it("reports RAG count deltas", () => {
    const base = summarize(projects, portfolio);
    const d = diffSummary(base, base);
    expect(d.ragCounts).toEqual({ RED: 0, AMBER: 0, GREEN: 0 });
  });
});
