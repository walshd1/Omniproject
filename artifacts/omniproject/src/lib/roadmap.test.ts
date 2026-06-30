import { describe, it, expect } from "vitest";
import {
  deriveSpan,
  buildRoadmap,
  pct,
  parseDate,
  STANDALONE_KEY,
  STANDALONE_NAME,
  type RoadmapProject,
} from "./roadmap";

const ms = (d: string) => Date.parse(d);

function project(over: Partial<RoadmapProject> = {}): RoadmapProject {
  return { id: "p", name: "Project", issueCount: 10, completedCount: 5, ...over };
}

describe("deriveSpan", () => {
  it("spans the earliest start to the latest due across all issues", () => {
    const span = deriveSpan([
      { startDate: "2026-03-01", dueDate: "2026-03-20" },
      { startDate: "2026-02-10", dueDate: "2026-04-01" },
    ]);
    expect(span).toEqual({ start: ms("2026-02-10"), end: ms("2026-04-01") });
  });

  it("treats a lone start or a lone due as evidence (no NaN, no skipped item)", () => {
    const span = deriveSpan([{ startDate: "2026-01-05" }, { dueDate: "2026-01-25" }]);
    expect(span).toEqual({ start: ms("2026-01-05"), end: ms("2026-01-25") });
  });

  it("returns null when no issue carries a usable date", () => {
    expect(deriveSpan([{ startDate: null, dueDate: null }, {}])).toBeNull();
    expect(deriveSpan([{ startDate: "not-a-date" }])).toBeNull();
  });
});

describe("buildRoadmap", () => {
  const projects: RoadmapProject[] = [
    project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Transformation", issueCount: 4, completedCount: 1 }),
    project({ id: "b", name: "Bravo", programmeId: "prog-1", programmeName: "Transformation" }),
    project({ id: "c", name: "Charlie" }), // standalone
    project({ id: "d", name: "Delta", programmeId: "prog-2", programmeName: "Growth" }),
    project({ id: "e", name: "Echo" }), // no dated issues → excluded
  ];
  const issuesByProject = {
    a: [{ startDate: "2026-03-01", dueDate: "2026-05-01" }],
    b: [{ startDate: "2026-02-01", dueDate: "2026-04-01" }],
    c: [{ dueDate: "2026-06-15" }],
    d: [{ startDate: "2026-01-10", dueDate: "2026-02-20" }],
    e: [{ startDate: null }],
  };

  it("groups projects into programme lanes and counts what was placed vs excluded", () => {
    const r = buildRoadmap(projects, issuesByProject);
    expect(r.totalProjects).toBe(5);
    expect(r.datedProjects).toBe(4); // Echo excluded
    const prog1 = r.lanes.find((l) => l.key === "prog-1")!;
    expect(prog1.name).toBe("Transformation");
    expect(prog1.bars.map((b) => b.projectId).sort()).toEqual(["a", "b"]);
  });

  it("derives the overall axis bounds from the earliest start and latest due across every bar", () => {
    const r = buildRoadmap(projects, issuesByProject);
    expect(r.min).toBe(ms("2026-01-10")); // Delta start
    expect(r.max).toBe(ms("2026-06-15")); // Charlie due
  });

  it("orders lanes earliest-first and always sinks the standalone lane to the bottom", () => {
    const r = buildRoadmap(projects, issuesByProject);
    const last = r.lanes[r.lanes.length - 1]!;
    expect(last.key).toBe(STANDALONE_KEY);
    expect(last.name).toBe(STANDALONE_NAME);
    // Growth (Jan) starts before Transformation (Feb), so it leads.
    expect(r.lanes[0]!.key).toBe("prog-2");
  });

  it("sorts bars within a lane by start and carries the completion rate", () => {
    const r = buildRoadmap(projects, issuesByProject);
    const prog1 = r.lanes.find((l) => l.key === "prog-1")!;
    expect(prog1.bars.map((b) => b.projectId)).toEqual(["b", "a"]); // Bravo (Feb) before Alpha (Mar)
    const alpha = prog1.bars.find((b) => b.projectId === "a")!;
    expect(alpha.completionRate).toBeCloseTo(0.25); // 1 of 4
  });

  it("is empty and zero-bounded when nothing is datable", () => {
    const r = buildRoadmap([project({ id: "z", issueCount: 0, completedCount: 0 })], { z: [] });
    expect(r.lanes).toEqual([]);
    expect(r.datedProjects).toBe(0);
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
  });
});

describe("pct", () => {
  it("maps the axis endpoints to 0 and 100 and the midpoint to 50", () => {
    expect(pct(0, 0, 100)).toBe(0);
    expect(pct(100, 0, 100)).toBe(100);
    expect(pct(50, 0, 100)).toBe(50);
  });

  it("clamps out-of-range values and guards a degenerate (min===max) axis", () => {
    expect(pct(-10, 0, 100)).toBe(0);
    expect(pct(150, 0, 100)).toBe(100);
    expect(pct(5, 5, 5)).toBe(0);
  });
});

describe("parseDate", () => {
  it("parses ISO dates and rejects empty / invalid input", () => {
    expect(parseDate("2026-01-01")).toBe(ms("2026-01-01"));
    expect(parseDate(null)).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("nope")).toBeNull();
  });
});
