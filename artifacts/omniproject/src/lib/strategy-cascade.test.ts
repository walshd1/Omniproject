import { describe, it, expect } from "vitest";
import { buildStrategyCascade, parseKeyResult, type CascadeItem } from "./strategy-cascade";

const item = (o: Partial<CascadeItem> & { id: string }): CascadeItem => ({ name: o.id, ...o });

describe("parseKeyResult", () => {
  it("parses 'name: actual/target' into an attainment %", () => {
    expect(parseKeyResult("NPS: 45/60")).toEqual({ label: "NPS", actual: 45, target: 60, attainmentPct: 75 });
  });
  it("parses 'name actual/target' without a colon", () => {
    expect(parseKeyResult("Signups 200/400")).toMatchObject({ label: "Signups", actual: 200, target: 400, attainmentPct: 50 });
  });
  it("keeps an unmeasurable label as-is", () => {
    expect(parseKeyResult("Improve onboarding")).toEqual({ label: "Improve onboarding", target: null, actual: null, attainmentPct: null });
  });
  it("guards divide-by-zero targets", () => {
    expect(parseKeyResult("X: 5/0").attainmentPct).toBeNull();
  });
});

describe("buildStrategyCascade", () => {
  it("builds a theme → objective → initiative tree", () => {
    const c = buildStrategyCascade([
      item({ id: "a", strategicTheme: "Growth", objectives: ["Expand EU"], progressPct: 60 }),
      item({ id: "b", strategicTheme: "Growth", objectives: ["Expand EU"], progressPct: 40 }),
    ]);
    expect(c.themes.length).toBe(1);
    expect(c.themes[0]!.theme).toBe("Growth");
    expect(c.themes[0]!.objectives.length).toBe(1);
    expect(c.themes[0]!.objectives[0]!.initiatives.length).toBe(2);
  });

  it("rolls objective progress up as a contribution-weighted mean", () => {
    const c = buildStrategyCascade([
      item({ id: "a", objectives: ["O1"], strategicContribution: 100, progressPct: 80 }),
      item({ id: "b", objectives: ["O1"], strategicContribution: 50, progressPct: 20 }),
    ]);
    // (100*80 + 50*20) / (150) = 60
    expect(c.themes[0]!.objectives[0]!.progressPct).toBe(60);
  });

  it("defaults missing contribution to 100 and missing progress to 0", () => {
    const c = buildStrategyCascade([item({ id: "a", objectives: ["O1"] })]);
    expect(c.themes[0]!.objectives[0]!.progressPct).toBe(0);
  });

  it("flags initiatives with no objective as unaligned and computes coverage", () => {
    const c = buildStrategyCascade([
      item({ id: "a", objectives: ["O1"], progressPct: 50 }),
      item({ id: "b" }), // no objective ⇒ unaligned
    ]);
    expect(c.unaligned.map((u) => u.id)).toEqual(["b"]);
    expect(c.coveragePct).toBe(50);
    expect(c.initiativeCount).toBe(2);
    expect(c.objectiveCount).toBe(1);
  });

  it("attaches parsed key results to their objective, de-duped", () => {
    const c = buildStrategyCascade([
      item({ id: "a", objectives: ["O1"], kpis: ["NPS: 45/60"] }),
      item({ id: "b", objectives: ["O1"], kpis: ["NPS: 45/60", "Revenue: 8/10"] }),
    ]);
    const krs = c.themes[0]!.objectives[0]!.keyResults;
    expect(krs.map((k) => k.label).sort()).toEqual(["NPS", "Revenue"]);
  });

  it("one initiative spanning two objectives appears under both", () => {
    const c = buildStrategyCascade([item({ id: "a", strategicTheme: "T", objectives: ["O1", "O2"], progressPct: 30 })]);
    expect(c.themes[0]!.objectives.length).toBe(2);
    expect(c.objectiveCount).toBe(2);
    expect(c.initiativeCount).toBe(1); // counted once as an initiative
  });

  it("is deterministic (themes + objectives sorted)", () => {
    const items = [
      item({ id: "a", strategicTheme: "Zeta", objectives: ["B obj"] }),
      item({ id: "b", strategicTheme: "Alpha", objectives: ["A obj"] }),
    ];
    const c = buildStrategyCascade(items);
    expect(c.themes.map((t) => t.theme)).toEqual(["Alpha", "Zeta"]);
  });
});
