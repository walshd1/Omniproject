import { describe, it, expect } from "vitest";
import { matchDemandToCapacity, type DemandRequest, type ResourceSkills } from "./skills-capacity";

const res = (id: string, skills: Record<string, number>, capacityHours: number, name = id): ResourceSkills => ({ resourceId: id, name, skills, capacityHours });
const req = (id: string, skill: string, hoursNeeded: number, minProficiency?: number): DemandRequest => ({ id, initiative: id, skill, hoursNeeded, ...(minProficiency ? { minProficiency } : {}) });

describe("matchDemandToCapacity", () => {
  it("fills demand from qualified capacity and reports full coverage when supply suffices", () => {
    const r = matchDemandToCapacity([res("r1", { react: 3 }, 100)], [req("d1", "react", 80)]);
    const react = r.skills.find((s) => s.skill === "react")!;
    expect(react.matchedHours).toBe(80);
    expect(react.unmetHours).toBe(0);
    expect(react.coveragePct).toBe(100);
    expect(r.totals.coveragePct).toBe(100);
  });

  it("surfaces the unmet gap when demand exceeds qualified capacity", () => {
    const r = matchDemandToCapacity([res("r1", { react: 3 }, 250)], [req("d1", "react", 400)]);
    const react = r.skills.find((s) => s.skill === "react")!;
    expect(react.demandHours).toBe(400);
    expect(react.matchedHours).toBe(250);
    expect(react.unmetHours).toBe(150);
    expect(react.coveragePct).toBe(62.5);
  });

  it("only counts resources at or above the requested proficiency bar", () => {
    const r = matchDemandToCapacity(
      [res("junior", { react: 2 }, 100), res("senior", { react: 4 }, 100)],
      [req("d1", "react", 150, 3)], // needs ≥ 3 ⇒ only senior qualifies
    );
    const react = r.skills.find((s) => s.skill === "react")!;
    expect(react.qualifiedResourceCount).toBe(1);
    expect(react.qualifiedCapacityHours).toBe(100);
    expect(react.unmetHours).toBe(50);
    // the junior was never allocated
    expect(r.allocations.every((a) => a.resourceId !== "junior")).toBe(true);
  });

  it("prefers higher-proficiency resources first", () => {
    const r = matchDemandToCapacity(
      [res("mid", { react: 3 }, 100), res("senior", { react: 5 }, 100)],
      [req("d1", "react", 60)],
    );
    // 60h of demand goes to the senior (highest proficiency) before touching the mid.
    expect(r.allocations).toEqual([{ requestId: "d1", resourceId: "senior", hours: 60 }]);
  });

  it("flags over-allocation across multiple requests on one resource", () => {
    const r = matchDemandToCapacity(
      [res("r1", { react: 3 }, 100)],
      [req("d1", "react", 80), req("d2", "react", 80)],
    );
    const load = r.resources.find((x) => x.resourceId === "r1")!;
    expect(load.assignedHours).toBe(100); // capped at capacity
    expect(load.overAllocatedHours).toBe(0);
    // second request can't be fully filled ⇒ unmet
    expect(r.totals.unmetHours).toBe(60);
  });

  it("skills are ranked worst-gap first", () => {
    const r = matchDemandToCapacity(
      [res("r1", { react: 3, go: 3 }, 50)],
      [req("d1", "react", 200), req("d2", "go", 60)],
    );
    expect(r.skills[0]!.skill).toBe("react"); // bigger unmet gap leads
  });

  it("is deterministic", () => {
    const resources = [res("a", { react: 4 }, 100), res("b", { react: 3 }, 100)];
    const demand = [req("d1", "react", 150)];
    expect(matchDemandToCapacity(resources, demand)).toEqual(matchDemandToCapacity(resources, demand));
  });
});
