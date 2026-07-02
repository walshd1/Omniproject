import { describe, it, expect } from "vitest";
import {
  scorePortfolio,
  moscowWeight,
  DEFAULT_PRIORITY_WEIGHTS,
  type ProjectPriorityInput,
  type PriorityInput,
  type PriorityWeights,
} from "./portfolio-priority";

function proj(over: Partial<ProjectPriorityInput> = {}): ProjectPriorityInput {
  return { projectId: "p", projectName: "P", programmeId: null, programmeName: null, items: [], cost: 0, capacityHours: 0, ...over };
}
function item(over: Partial<PriorityInput> = {}): PriorityInput {
  return { id: "i", title: "I", ...over };
}

describe("moscowWeight", () => {
  it("maps free-form MoSCoW strings to a 0-100 weight", () => {
    expect(moscowWeight("Must have")).toBe(100);
    expect(moscowWeight("SHOULD")).toBe(66);
    expect(moscowWeight("could")).toBe(33);
    expect(moscowWeight("Won't have")).toBe(0);
    expect(moscowWeight("will not")).toBe(0);
  });
  it("returns null for absent or unrecognised values", () => {
    expect(moscowWeight(null)).toBeNull();
    expect(moscowWeight(undefined)).toBeNull();
    expect(moscowWeight("")).toBeNull();
    expect(moscowWeight("nice to have")).toBeNull();
  });
});

describe("scorePortfolio", () => {
  it("ranks the highest composite score first", () => {
    const scored = scorePortfolio([
      proj({ projectId: "low", projectName: "Low", items: [item({ riceScore: 10, wsjf: 5 })] }),
      proj({ projectId: "high", projectName: "High", items: [item({ riceScore: 90, wsjf: 80 })] }),
    ]);
    expect(scored.map((s) => s.projectId)).toEqual(["high", "low"]);
    expect(scored[0]!.rank).toBe(1);
    expect(scored[1]!.rank).toBe(2);
    expect(scored[0]!.compositeScore).toBeGreaterThan(scored[1]!.compositeScore!);
  });

  it("does not penalise a project for a dimension it doesn't report — scores on what it has", () => {
    const scored = scorePortfolio([
      // Only reports MoSCoW=must (100); no RICE/WSJF/strategic/benefit at all.
      proj({ projectId: "a", projectName: "A", items: [item({ moscow: "must" })] }),
    ]);
    expect(scored[0]!.compositeScore).toBe(100); // the only reported dimension is maxed, so composite = 100
    expect(scored[0]!.riceScore).toBeNull();
    expect(scored[0]!.wsjf).toBeNull();
  });

  it("gives a project with no signal on any dimension a null compositeScore and sorts it last", () => {
    const scored = scorePortfolio([
      proj({ projectId: "empty", projectName: "Empty", items: [item()] }),
      proj({ projectId: "scored", projectName: "Scored", items: [item({ riceScore: 50 })] }),
    ]);
    expect(scored[0]!.projectId).toBe("scored");
    expect(scored[1]!.projectId).toBe("empty");
    expect(scored[1]!.compositeScore).toBeNull();
  });

  it("min-max normalises RICE/WSJF across the set so a single measured project scores full marks", () => {
    const scored = scorePortfolio([proj({ projectId: "solo", projectName: "Solo", items: [item({ riceScore: 7 })] })]);
    expect(scored[0]!.compositeScore).toBe(100);
  });

  it("honours custom weights (a zero weight switches a dimension off)", () => {
    const inputs: ProjectPriorityInput[] = [
      proj({ projectId: "riceOnly", projectName: "RiceOnly", items: [item({ riceScore: 10, moscow: "must" })] }),
      proj({ projectId: "riceHigh", projectName: "RiceHigh", items: [item({ riceScore: 100, moscow: "wont" })] }),
    ];
    const weights: PriorityWeights = { ...DEFAULT_PRIORITY_WEIGHTS, rice: 100, wsjf: 0, moscow: 0, strategic: 0, benefit: 0 };
    const scored = scorePortfolio(inputs, weights);
    // With only RICE weighted, riceHigh (normalised to 100) must outrank riceOnly (normalised to 0)
    // even though riceOnly has a "must" MoSCoW — that dimension is switched off.
    expect(scored[0]!.projectId).toBe("riceHigh");
    expect(scored[0]!.compositeScore).toBe(100);
    expect(scored[1]!.compositeScore).toBe(0);
  });

  it("rolls benefit value up via the existing benefits summariser (risk-adjusted expected value)", () => {
    const scored = scorePortfolio([
      proj({ projectId: "a", projectName: "A", items: [item({ plannedBenefitValue: 100000, benefitConfidence: 50 })] }),
    ]);
    expect(scored[0]!.benefitValue).toBe(50000);
  });

  it("computes valueDensity (composite per £1k cost) only when cost > 0 and a score exists", () => {
    const scored = scorePortfolio([
      proj({ projectId: "a", projectName: "A", items: [item({ riceScore: 50 })], cost: 1000 }),
      proj({ projectId: "b", projectName: "B", items: [item({ riceScore: 50 })], cost: 0 }),
    ]);
    const a = scored.find((s) => s.projectId === "a")!;
    const b = scored.find((s) => s.projectId === "b")!;
    expect(a.valueDensity).not.toBeNull();
    expect(b.valueDensity).toBeNull();
  });

  it("averages multiple items' RICE/WSJF/MoSCoW/strategic values per project", () => {
    const scored = scorePortfolio([
      proj({
        projectId: "a",
        projectName: "A",
        items: [item({ riceScore: 10 }), item({ riceScore: 30 }), item({ riceScore: 20 })],
      }),
    ]);
    expect(scored[0]!.riceScore).toBe(20);
  });
});

// ── Dirty-data resilience ──────────────────────────────────────────────────
describe("scorePortfolio — dirty read model", () => {
  it("drops non-finite values instead of poisoning the average, and keeps every number finite", () => {
    const dirty: ProjectPriorityInput[] = [
      proj({
        projectId: "a",
        projectName: "A",
        items: [
          { id: "1", title: "1", riceScore: "50" as unknown as number, wsjf: NaN as unknown as number, moscow: "must" },
          { id: "2", title: "2", riceScore: 30, strategicContribution: 500 as unknown as number }, // out-of-range, clamped
        ],
        cost: "1000" as unknown as number,
        capacityHours: null as unknown as number,
      }),
    ];
    const scored = scorePortfolio(dirty);
    expect(scored).toHaveLength(1);
    const s = scored[0]!;
    expect(s.riceScore).toBe(30); // "50" (string) dropped, only the numeric 30 counted
    expect(s.wsjf).toBeNull(); // NaN dropped entirely
    expect(s.strategicScore).toBe(100); // 500 clamped to 100
    expect(Number.isFinite(s.cost)).toBe(true);
    expect(Number.isFinite(s.capacityHours)).toBe(true);
    expect(s.compositeScore === null || Number.isFinite(s.compositeScore)).toBe(true);
  });

  it("is safe on an empty portfolio", () => {
    expect(scorePortfolio([])).toEqual([]);
  });
});
