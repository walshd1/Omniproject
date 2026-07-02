import { describe, it, expect } from "vitest";
import {
  summariseFunding,
  evaluateFundingScenario,
  fundAll,
  autoFundByRank,
  diffFundingTotals,
  decisionFor,
  type FundingDecisions,
} from "./funding-scenario";
import type { ProjectPriorityScore } from "./portfolio-priority";

function score(over: Partial<ProjectPriorityScore> = {}): ProjectPriorityScore {
  return {
    projectId: "p", projectName: "P", programmeId: null, programmeName: null, rank: 1,
    riceScore: null, wsjf: null, moscowScore: null, strategicScore: null, benefitValue: 0,
    compositeScore: 50, cost: 100, capacityHours: 10, valueDensity: null,
    ...over,
  };
}

const PORTFOLIO: ProjectPriorityScore[] = [
  score({ projectId: "a", projectName: "A", rank: 1, compositeScore: 90, cost: 500, capacityHours: 40, benefitValue: 10000 }),
  score({ projectId: "b", projectName: "B", rank: 2, compositeScore: 60, cost: 300, capacityHours: 20, benefitValue: 5000 }),
  score({ projectId: "c", projectName: "C", rank: 3, compositeScore: 30, cost: 800, capacityHours: 60, benefitValue: 2000 }),
];

describe("decisionFor", () => {
  it("defaults to fund when a project has no explicit decision", () => {
    expect(decisionFor({}, "a")).toBe("fund");
    expect(decisionFor({ a: "cut" }, "a")).toBe("cut");
  });
});

describe("summariseFunding", () => {
  it("rolls up cost/capacity/benefit by decision bucket", () => {
    const decisions: FundingDecisions = { a: "fund", b: "defer", c: "cut" };
    const t = summariseFunding(PORTFOLIO, decisions);
    expect(t.fundedCount).toBe(1);
    expect(t.fundedCost).toBe(500);
    expect(t.fundedCapacityHours).toBe(40);
    expect(t.fundedBenefit).toBe(10000);
    expect(t.fundedScore).toBe(90);
    expect(t.deferredCount).toBe(1);
    expect(t.deferredCost).toBe(300);
    expect(t.cutCount).toBe(1);
    expect(t.cutCost).toBe(800);
  });

  it("treats an undecided project as funded (status quo)", () => {
    const t = summariseFunding(PORTFOLIO, {});
    expect(t.fundedCount).toBe(3);
    expect(t.fundedCost).toBe(500 + 300 + 800);
  });
});

describe("evaluateFundingScenario", () => {
  it("reports remaining budget/capacity when funded totals are within the caps", () => {
    const r = evaluateFundingScenario(PORTFOLIO, { a: "fund", b: "defer", c: "defer" }, 1000, 100);
    expect(r.budget.used).toBe(500);
    expect(r.budget.remaining).toBe(500);
    expect(r.budget.over).toBe(0);
    expect(r.capacity.remaining).toBe(60);
  });

  it("flags an over-budget / over-capacity scenario without hiding the usage", () => {
    const r = evaluateFundingScenario(PORTFOLIO, fundAll(PORTFOLIO), 1000, 50);
    expect(r.budget.used).toBe(1600);
    expect(r.budget.over).toBe(600);
    expect(r.capacity.over).toBe(70);
  });

  it("reports uncapped usage (null cap) with no over-cap penalty", () => {
    const r = evaluateFundingScenario(PORTFOLIO, fundAll(PORTFOLIO), null, null);
    expect(r.budget.cap).toBeNull();
    expect(r.budget.remaining).toBeNull();
    expect(r.budget.over).toBe(0);
  });
});

describe("fundAll", () => {
  it("funds every project", () => {
    const decisions = fundAll(PORTFOLIO);
    expect(Object.values(decisions).every((d) => d === "fund")).toBe(true);
    expect(Object.keys(decisions)).toHaveLength(3);
  });
});

describe("autoFundByRank", () => {
  it("greedily funds top-ranked projects until the budget cap would be exceeded", () => {
    // a=500, b=300, c=800 in rank order a,b,c. Cap 700: a fits (500), a+b=800 doesn't fit ⇒ b deferred,
    // c doesn't fit either (500+800=1300>700) ⇒ deferred.
    const decisions = autoFundByRank(PORTFOLIO, 700, null);
    expect(decisions["a"]).toBe("fund");
    expect(decisions["b"]).toBe("defer");
    expect(decisions["c"]).toBe("defer");
  });

  it("funds everything when both caps are null (uncapped)", () => {
    const decisions = autoFundByRank(PORTFOLIO, null, null);
    expect(Object.values(decisions).every((d) => d === "fund")).toBe(true);
  });

  it("respects capacity cap independently of budget cap", () => {
    const decisions = autoFundByRank(PORTFOLIO, null, 45);
    expect(decisions["a"]).toBe("fund"); // 40 <= 45
    expect(decisions["b"]).toBe("defer"); // 40+20=60 > 45
  });

  it("preserves a seeded cut instead of re-funding it", () => {
    const decisions = autoFundByRank(PORTFOLIO, 10000, 10000, { a: "cut" });
    expect(decisions["a"]).toBe("cut");
    expect(decisions["b"]).toBe("fund");
    expect(decisions["c"]).toBe("fund");
  });
});

describe("diffFundingTotals", () => {
  it("computes the delta between a scenario and the fund-all baseline", () => {
    const baseline = summariseFunding(PORTFOLIO, fundAll(PORTFOLIO));
    const scenario = summariseFunding(PORTFOLIO, { a: "fund", b: "defer", c: "cut" });
    const delta = diffFundingTotals(baseline, scenario);
    expect(delta.fundedCount).toBe(1 - 3);
    expect(delta.fundedCost).toBe(500 - 1600);
    expect(delta.fundedBenefit).toBe(10000 - 17000);
  });
});
