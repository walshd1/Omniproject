import { describe, it, expect } from "vitest";
import type { ResourceCapacity } from "@workspace/api-client-react";
import type { ProjectCapacity } from "./capacity-rollup";
import {
  flattenAllocations,
  levelPortfolio,
  skillsSupplyDemand,
  residencyGate,
  simulateMove,
  type ResidencyPosture,
} from "./resource-levelling";

function res(over: Partial<ResourceCapacity> = {}): ResourceCapacity {
  return {
    resourceId: "r1", resourceName: "Ada", role: "eng",
    allocationPercentage: 60, assignedHours: 24, availableHours: 40,
    utilizationState: "OPTIMAL",
    ...over,
  } as ResourceCapacity;
}
function proj(over: Partial<ProjectCapacity> = {}): ProjectCapacity {
  return { projectId: "p1", projectName: "P1", programmeId: "prog-a", programmeName: "Alpha", resources: [res()], ...over };
}

const OFF: ResidencyPosture = { enabled: false, allowedRegions: [] };

describe("flattenAllocations", () => {
  it("flattens resources across projects, tagging each with its project + programme + country/skills", () => {
    const rows = flattenAllocations([
      proj({ projectId: "p1", resources: [res({ resourceId: "r1", country: "eu", skills: ["backend"] })] }),
      proj({ projectId: "p2", programmeId: "prog-b", programmeName: "Beta", resources: [res({ resourceId: "r1", country: "eu" })] }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ resourceId: "r1", projectId: "p1", programmeId: "prog-a", country: "eu", skills: ["backend"] });
    expect(rows[1]).toMatchObject({ resourceId: "r1", projectId: "p2", programmeId: "prog-b" });
  });

  it("coerces dirty numbers and defaults missing country/skills", () => {
    const rows = flattenAllocations([proj({ resources: [res({ allocationPercentage: "80" as never, assignedHours: NaN as never, country: undefined, skills: undefined })] })]);
    expect(rows[0]!.allocationPercentage).toBe(80);
    expect(rows[0]!.assignedHours).toBe(0);
    expect(rows[0]!.country).toBeNull();
    expect(rows[0]!.skills).toEqual([]);
  });
});

describe("levelPortfolio", () => {
  it("sums a person's allocation ACROSS programmes — over-allocation the per-project roll-up misses", () => {
    const { people, overAllocated } = levelPortfolio([
      proj({ projectId: "p1", programmeId: "prog-a", programmeName: "Alpha", resources: [res({ resourceId: "r1", allocationPercentage: 60 })] }),
      proj({ projectId: "p2", programmeId: "prog-b", programmeName: "Beta", resources: [res({ resourceId: "r1", allocationPercentage: 60 })] }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0]!.totalAllocationPercentage).toBe(120);
    expect(people[0]!.crossProgramme).toBe(true);
    expect(overAllocated).toHaveLength(1);
    expect(overAllocated[0]!.resourceId).toBe("r1");
  });

  it("flags cross-country spread and leaves single-country people unflagged", () => {
    const { people } = levelPortfolio([
      proj({ projectId: "p1", resources: [res({ resourceId: "r1", country: "eu" })] }),
      proj({ projectId: "p2", programmeId: "prog-b", resources: [res({ resourceId: "r1", country: "us" })] }),
      proj({ projectId: "p3", programmeId: "prog-c", resources: [res({ resourceId: "r2", country: "eu" })] }),
    ]);
    const r1 = people.find((p) => p.resourceId === "r1")!;
    const r2 = people.find((p) => p.resourceId === "r2")!;
    expect(r1.crossCountry).toBe(true);
    expect(r1.countries.sort()).toEqual(["eu", "us"]);
    expect(r2.crossCountry).toBe(false);
  });

  it("flags under-allocated people below the threshold with spare availability, as lend candidates", () => {
    const { underAllocated } = levelPortfolio([
      proj({ resources: [res({ resourceId: "r1", allocationPercentage: 30, assignedHours: 12, availableHours: 40 })] }),
    ], 80);
    expect(underAllocated).toHaveLength(1);
    expect(underAllocated[0]!.resourceId).toBe("r1");
  });

  it("excludes a person with zero declared availability from under-allocated (no real capacity signal)", () => {
    const { underAllocated } = levelPortfolio([
      proj({ resources: [res({ resourceId: "r1", allocationPercentage: 0, assignedHours: 0, availableHours: 0 })] }),
    ]);
    expect(underAllocated).toHaveLength(0);
  });

  it("sorts people most-allocated first", () => {
    const { people } = levelPortfolio([
      proj({ resources: [res({ resourceId: "low", resourceName: "Low", allocationPercentage: 20 })] }),
      proj({ resources: [res({ resourceId: "hot", resourceName: "Hot", allocationPercentage: 150 })] }),
    ]);
    expect(people.map((p) => p.resourceId)).toEqual(["hot", "low"]);
  });
});

describe("skillsSupplyDemand", () => {
  it("sums supply (available hours) and demand (assigned hours) per skill tag", () => {
    const balance = skillsSupplyDemand([
      proj({ resources: [
        res({ resourceId: "r1", skills: ["backend"], availableHours: 40, assignedHours: 20 }),
        res({ resourceId: "r2", skills: ["backend"], availableHours: 40, assignedHours: 30 }),
      ] }),
    ]);
    const backend = balance.find((b) => b.skill === "backend")!;
    expect(backend.supplyHeadcount).toBe(2);
    expect(backend.supplyAvailableHours).toBe(80);
    expect(backend.demandAssignedHours).toBe(50);
    expect(backend.balanceHours).toBe(30);
    expect(backend.pressure).toBe("balanced"); // demand (50) is between supply*0.5 (40) and supply (80)
  });

  it("flags a surplus when demand is well below half of supply", () => {
    const balance = skillsSupplyDemand([
      proj({ resources: [res({ resourceId: "r1", skills: ["qa"], availableHours: 40, assignedHours: 5 })] }),
    ]);
    expect(balance[0]!.pressure).toBe("surplus");
  });

  it("flags a shortage when demand exceeds supply, and skips resources with no declared skills", () => {
    const balance = skillsSupplyDemand([
      proj({ resources: [
        res({ resourceId: "r1", skills: ["data-science"], availableHours: 20, assignedHours: 30 }),
        res({ resourceId: "r2", skills: [], availableHours: 40, assignedHours: 10 }),
      ] }),
    ]);
    expect(balance).toHaveLength(1);
    expect(balance[0]!.skill).toBe("data-science");
    expect(balance[0]!.pressure).toBe("shortage");
  });
});

describe("residencyGate", () => {
  it("allows everything when residency enforcement is off", () => {
    expect(residencyGate(null, OFF)).toEqual({ allowed: true });
    expect(residencyGate("outside-allowed-set", OFF)).toEqual({ allowed: true });
  });

  it("fails closed on an undeclared country once enforcement is on", () => {
    const v = residencyGate(null, { enabled: true, allowedRegions: ["eu"] });
    expect(v.allowed).toBe(false);
    expect(v.reason).toMatch(/no declared country/);
  });

  it("blocks a country outside the allowed set (case-insensitively matches when inside it)", () => {
    expect(residencyGate("us", { enabled: true, allowedRegions: ["eu"] }).allowed).toBe(false);
    expect(residencyGate("EU", { enabled: true, allowedRegions: ["eu"] }).allowed).toBe(true);
  });
});

describe("simulateMove", () => {
  const projects: ProjectCapacity[] = [
    proj({ projectId: "p1", programmeId: "prog-a", programmeName: "Alpha", resources: [res({ resourceId: "r1", allocationPercentage: 100, assignedHours: 40, availableHours: 40 })] }),
    proj({ projectId: "p2", programmeId: "prog-b", programmeName: "Beta", resources: [] }),
  ];

  it("shifts allocation from the origin to the destination programme and reports the before/after roll-up on both sides", () => {
    const result = simulateMove(projects, { resourceId: "r1", fromProjectId: "p1", toProjectId: "p2", movePercentage: 40 }, OFF);
    expect(result.allowed).toBe(true);
    expect(result.from.before.overAllocated).toBe(0); // 100% is not > 100, the roll-up's over-allocation threshold
    expect(result.from.after.assignedHours).toBe(24); // 40 - 16 (40% of 40h)
    expect(result.to.after.assignedHours).toBe(16);
    expect(result.to.after.allocations).toBe(1); // a new allocation row was synthesised on the destination
  });

  it("relieves an over-allocated origin programme and shows the destination's over-allocation delta rising", () => {
    const hot: ProjectCapacity[] = [
      proj({ projectId: "p1", programmeId: "prog-a", resources: [res({ resourceId: "r1", allocationPercentage: 150, assignedHours: 60, availableHours: 40 })] }),
      proj({ projectId: "p2", programmeId: "prog-b", resources: [res({ resourceId: "r2", allocationPercentage: 90, assignedHours: 36, availableHours: 40 })] }),
    ];
    const result = simulateMove(hot, { resourceId: "r1", fromProjectId: "p1", toProjectId: "p2", movePercentage: 60 }, OFF);
    expect(result.allowed).toBe(true);
    expect(result.from.before.overAllocated).toBe(1);
    expect(result.from.after.overAllocated).toBe(0); // 150 - 60 = 90, no longer over
    expect(result.from.overAllocatedDelta).toBe(-1);
  });

  it("blocks the move and reports before === after when the resource isn't on the origin project", () => {
    const result = simulateMove(projects, { resourceId: "ghost", fromProjectId: "p1", toProjectId: "p2", movePercentage: 10 }, OFF);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not allocated/);
    expect(result.from.before).toEqual(result.from.after);
  });

  it("blocks a move for a resource outside the allowed residency region, even when enforcement is on for an unrelated reason", () => {
    const foreign: ProjectCapacity[] = [
      proj({ projectId: "p1", resources: [res({ resourceId: "r1", country: "us", allocationPercentage: 100, assignedHours: 40, availableHours: 40 })] }),
      proj({ projectId: "p2", programmeId: "prog-b", resources: [] }),
    ];
    const result = simulateMove(foreign, { resourceId: "r1", fromProjectId: "p1", toProjectId: "p2", movePercentage: 20 }, { enabled: true, allowedRegions: ["eu"] });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not in the allowed region set/);
    expect(result.from.after).toEqual(result.from.before); // no scenario applied
  });

  it("allows a move for a resource inside the allowed residency region", () => {
    const domestic: ProjectCapacity[] = [
      proj({ projectId: "p1", resources: [res({ resourceId: "r1", country: "eu", allocationPercentage: 100, assignedHours: 40, availableHours: 40 })] }),
      proj({ projectId: "p2", programmeId: "prog-b", resources: [] }),
    ];
    const result = simulateMove(domestic, { resourceId: "r1", fromProjectId: "p1", toProjectId: "p2", movePercentage: 20 }, { enabled: true, allowedRegions: ["eu"] });
    expect(result.allowed).toBe(true);
  });

  it("clamps the moved percentage to the resource's current allocation", () => {
    const result = simulateMove(projects, { resourceId: "r1", fromProjectId: "p1", toProjectId: "p2", movePercentage: 500 }, OFF);
    expect(result.movePercentage).toBe(100);
    expect(result.from.after.assignedHours).toBe(0);
  });

  it("reports a blocked result with a clear reason for an unknown origin/destination project", () => {
    const missingFrom = simulateMove(projects, { resourceId: "r1", fromProjectId: "nope", toProjectId: "p2", movePercentage: 10 }, OFF);
    expect(missingFrom.allowed).toBe(false);
    expect(missingFrom.reason).toMatch(/origin project/);
    const missingTo = simulateMove(projects, { resourceId: "r1", fromProjectId: "p1", toProjectId: "nope", movePercentage: 10 }, OFF);
    expect(missingTo.allowed).toBe(false);
    expect(missingTo.reason).toMatch(/destination project/);
  });
});
