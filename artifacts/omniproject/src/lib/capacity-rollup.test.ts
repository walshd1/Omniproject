import { describe, it, expect } from "vitest";
import type { ResourceCapacity } from "@workspace/api-client-react";
import { rollupByProgramme, type ProjectCapacity } from "./capacity-rollup";

function res(over: Partial<ResourceCapacity> = {}): ResourceCapacity {
  return { resourceName: "x", role: "eng", allocationPercentage: 80, assignedHours: 32, availableHours: 40, ...over } as ResourceCapacity;
}
function proj(over: Partial<ProjectCapacity> = {}): ProjectCapacity {
  return { projectId: "p", projectName: "P", programmeId: null, programmeName: null, resources: [res()], ...over };
}

describe("rollupByProgramme", () => {
  it("groups projects by programme and totals hours + utilisation", () => {
    const { programmes, portfolio } = rollupByProgramme([
      proj({ projectId: "a", programmeId: "prog-1", programmeName: "Platform", resources: [res({ assignedHours: 40, availableHours: 40, allocationPercentage: 100 })] }),
      proj({ projectId: "b", programmeId: "prog-1", programmeName: "Platform", resources: [res({ assignedHours: 20, availableHours: 40, allocationPercentage: 50 })] }),
    ]);
    expect(programmes).toHaveLength(1);
    expect(programmes[0]).toMatchObject({ key: "prog-1", label: "Platform", projects: 2, allocations: 2, assignedHours: 60, availableHours: 80 });
    expect(programmes[0]!.utilisation).toBe(75); // 60/80
    expect(portfolio.utilisation).toBe(75);
  });

  it("counts over-allocations and sorts programmes by utilisation desc", () => {
    const { programmes } = rollupByProgramme([
      proj({ programmeId: "low", programmeName: "Low", resources: [res({ assignedHours: 10, availableHours: 40, allocationPercentage: 25 })] }),
      proj({ programmeId: "hot", programmeName: "Hot", resources: [res({ assignedHours: 60, availableHours: 40, allocationPercentage: 150 })] }),
    ]);
    expect(programmes.map((p) => p.key)).toEqual(["hot", "low"]); // most-utilised first
    expect(programmes[0]!.overAllocated).toBe(1);
  });

  it("puts standalone projects in their own group and leaves utilisation null when no availability", () => {
    const { programmes } = rollupByProgramme([
      proj({ programmeId: null, resources: [res({ assignedHours: 5, availableHours: 0, allocationPercentage: 0 })] }),
    ]);
    expect(programmes[0]!.label).toBe("Standalone");
    expect(programmes[0]!.utilisation).toBeNull();
  });
});

// ── Dirty-data resilience (messy-data generator regression) ──────────────────
describe("rollupByProgramme — dirty resource numbers", () => {
  it("does not throw and keeps totals finite when hours arrive as string/null/NaN", () => {
    const { programmes, portfolio } = rollupByProgramme([
      proj({ resources: [
        res({ assignedHours: "32" as never, availableHours: null as never, allocationPercentage: "120" as never }),
        res({ assignedHours: NaN as never, availableHours: 40, allocationPercentage: Infinity as never }),
        res({ assignedHours: 8, availableHours: 40 }),
      ] }),
    ]);
    for (const r of [...programmes, portfolio]) {
      expect(Number.isFinite(r.assignedHours)).toBe(true);
      expect(Number.isFinite(r.availableHours)).toBe(true);
      expect(r.utilisation === null || Number.isFinite(r.utilisation)).toBe(true);
    }
    expect(portfolio.assignedHours).toBe(40); // 32 + 0 + 8
    expect(portfolio.availableHours).toBe(80); // 0 + 40 + 40
    expect(portfolio.overAllocated).toBe(1); // "120" coerces > 100; Infinity is treated as 0 (dirty), so not over
  });
});
