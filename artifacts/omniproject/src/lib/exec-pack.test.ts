import { describe, it, expect } from "vitest";
import type { PortfolioHealthSummary } from "@workspace/api-client-react";
import { buildExecHealth, execHeadline } from "./exec-pack";

function h(over: Partial<PortfolioHealthSummary>): PortfolioHealthSummary {
  return { projectId: "p", projectName: "P", ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0, ...over } as PortfolioHealthSummary;
}

describe("buildExecHealth", () => {
  const rows = [
    h({ projectId: "a", ragStatus: "GREEN" }),
    h({ projectId: "b", ragStatus: "AMBER", scheduleVarianceDays: -3, activeBlockersCount: 1 }),
    h({ projectId: "c", ragStatus: "RED", scheduleVarianceDays: -10, budgetVariancePercentage: 22, activeBlockersCount: 2 }),
    h({ projectId: "d", ragStatus: "RED", scheduleVarianceDays: -1, activeBlockersCount: 5 }),
  ];

  it("counts the RAG spread and at-risk share", () => {
    const s = buildExecHealth(rows);
    expect(s.rag).toEqual({ GREEN: 1, AMBER: 1, RED: 2 });
    expect(s.total).toBe(4);
    expect(s.atRiskPct).toBeCloseTo(0.75, 6);
  });

  it("sums blockers and tracks the worst slip", () => {
    const s = buildExecHealth(rows);
    expect(s.totalBlockers).toBe(8);
    expect(s.worstSlipDays).toBe(-10);
  });

  it("lists only exceptions (AMBER+RED), most severe first (RED before AMBER, then by blockers)", () => {
    const s = buildExecHealth(rows);
    expect(s.exceptions.map((e) => e.projectId)).toEqual(["d", "c", "b"]); // both REDs first; d has 5 blockers > c's 2
    expect(s.exceptions.every((e) => e.rag !== "GREEN")).toBe(true);
  });

  it("an all-green portfolio has no exceptions and 0 at-risk", () => {
    const s = buildExecHealth([h({ ragStatus: "GREEN" }), h({ ragStatus: "GREEN" })]);
    expect(s.exceptions).toEqual([]);
    expect(s.atRiskPct).toBe(0);
  });

  it("empty portfolio is safe", () => {
    const s = buildExecHealth([]);
    expect(s.total).toBe(0);
    expect(s.atRiskPct).toBe(0);
    expect(execHeadline(s)).toMatch(/No projects/);
  });
});

describe("execHeadline", () => {
  it("summarises posture in one line", () => {
    const s = buildExecHealth([h({ ragStatus: "GREEN" }), h({ ragStatus: "RED", scheduleVarianceDays: -7, activeBlockersCount: 3 })]);
    expect(execHeadline(s)).toContain("1/2 on track");
    expect(execHeadline(s)).toContain("worst slip -7d");
    expect(execHeadline(s)).toContain("3 active blocker");
  });
});
