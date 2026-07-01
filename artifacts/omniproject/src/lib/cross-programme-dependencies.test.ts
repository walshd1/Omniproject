import { describe, it, expect } from "vitest";
import { crossProgrammeMap, itemDurationDays, refIds, type DepItem } from "./cross-programme-dependencies";

const item = (o: Partial<DepItem> & { id: string }): DepItem => ({ title: o.id, ...o });

describe("refIds", () => {
  it("normalises single, array, and empty references", () => {
    expect(refIds("x")).toEqual(["x"]);
    expect(refIds([" a ", "b", "", null as unknown as string])).toEqual(["a", "b"]);
    expect(refIds(null)).toEqual([]);
    expect(refIds(undefined)).toEqual([]);
    expect(refIds("   ")).toEqual([]);
  });
});

describe("itemDurationDays", () => {
  it("uses the inclusive start→due span when both dates are valid", () => {
    expect(itemDurationDays({ startDate: "2026-01-01", dueDate: "2026-01-05" })).toBe(5);
  });
  it("floors to 1 day when dates are missing or invalid or inverted", () => {
    expect(itemDurationDays({ startDate: null, dueDate: null })).toBe(1);
    expect(itemDurationDays({ startDate: "2026-01-10", dueDate: "2026-01-01" })).toBe(1);
    expect(itemDurationDays({ startDate: "not-a-date", dueDate: "2026-01-05" })).toBe(1);
  });
});

describe("crossProgrammeMap", () => {
  it("returns empty structures for no items", () => {
    const m = crossProgrammeMap([]);
    expect(m.nodes).toEqual([]);
    expect(m.edges).toEqual([]);
    expect(m.crossProgrammeEdges).toEqual([]);
    expect(m.criticalPath).toEqual([]);
    expect(m.projectDuration).toBe(0);
    expect(m.hasCycle).toBe(false);
  });

  it("derives a precedence edge from dependsOn (predecessor → dependent)", () => {
    const m = crossProgrammeMap([
      item({ id: "a", programmeId: "P1", startDate: "2026-01-01", dueDate: "2026-01-03" }),
      item({ id: "b", programmeId: "P1", dependsOn: "a", startDate: "2026-01-04", dueDate: "2026-01-06" }),
    ]);
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ from: "a", to: "b", crossProgramme: false });
    expect(m.criticalPath).toEqual(["a", "b"]);
    expect(m.projectDuration).toBe(6); // 3-day a + 3-day b
  });

  it("flags edges that cross a programme boundary", () => {
    const m = crossProgrammeMap([
      item({ id: "a", programmeId: "P1", startDate: "2026-01-01", dueDate: "2026-01-02" }),
      item({ id: "b", programmeId: "P2", dependsOn: ["a"], startDate: "2026-01-03", dueDate: "2026-01-04" }),
      item({ id: "c", programmeId: "P2", dependsOn: ["b"], startDate: "2026-01-05", dueDate: "2026-01-06" }),
    ]);
    expect(m.crossProgrammeEdges).toHaveLength(1);
    expect(m.crossProgrammeEdges[0]).toMatchObject({ from: "a", to: "b", fromProgramme: "P1", toProgramme: "P2" });
    // The critical chain reaches across both programmes.
    expect(m.criticalPath).toEqual(["a", "b", "c"]);
    expect(m.criticalProgrammes).toEqual(["P1", "P2"]);
  });

  it("treats a standalone (no programmeId) endpoint as crossing when the other has a programme", () => {
    const m = crossProgrammeMap([
      item({ id: "a" }),
      item({ id: "b", programmeId: "P1", dependsOn: "a" }),
    ]);
    expect(m.crossProgrammeEdges).toHaveLength(1);
    expect(m.crossProgrammeEdges[0]).toMatchObject({ fromProgramme: null, toProgramme: "P1" });
  });

  it("drops dangling references and self-references", () => {
    const m = crossProgrammeMap([
      item({ id: "a", dependsOn: ["ghost", "a"] }),
      item({ id: "b", dependsOn: "a" }),
    ]);
    // only a→b survives (ghost dangling, a→a self)
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ from: "a", to: "b" });
  });

  it("dedupes repeated dependsOn references", () => {
    const m = crossProgrammeMap([
      item({ id: "a" }),
      item({ id: "b", dependsOn: ["a", "a"] }),
    ]);
    expect(m.edges).toHaveLength(1);
  });

  it("ignores parentTask (containment, not scheduling precedence)", () => {
    const m = crossProgrammeMap([
      item({ id: "epic" }),
      item({ id: "child", parentTask: "epic" }),
    ]);
    expect(m.edges).toEqual([]);
    expect(m.criticalPath.length).toBeGreaterThan(0); // still schedules the items
  });

  it("surfaces a cycle without hanging and still schedules the acyclic remainder", () => {
    const m = crossProgrammeMap([
      item({ id: "a", dependsOn: "b" }),
      item({ id: "b", dependsOn: "a" }),
      item({ id: "ok", startDate: "2026-01-01", dueDate: "2026-01-03" }),
    ]);
    expect(m.hasCycle).toBe(true);
    expect(m.unscheduled.sort()).toEqual(["a", "b"]);
    expect(m.criticalPath).toContain("ok");
  });

  it("gives dateless items a 1-day duration so dependent chains still schedule", () => {
    const m = crossProgrammeMap([
      item({ id: "a" }),
      item({ id: "b", dependsOn: "a" }),
    ]);
    expect(m.projectDuration).toBe(2);
    expect(m.nodes.find((n) => n.id === "b")!.es).toBe(1);
  });

  it("carries programme metadata through onto nodes", () => {
    const m = crossProgrammeMap([
      item({ id: "a", programmeId: "P1", programmeName: "Platform", title: "Build API" }),
    ]);
    expect(m.nodes[0]).toMatchObject({ id: "a", title: "Build API", programmeId: "P1", programmeName: "Platform" });
  });
});
