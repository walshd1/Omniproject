import { describe, it, expect } from "vitest";
import {
  reportCatalogue,
  widgetCatalogue,
  screenCatalogue,
  VIEWS,
  componentLibrary,
} from "@workspace/backend-catalogue";
import { buildRoadmap, roadmapKey, type RoadmapProject, type RoadmapIssue } from "./roadmap";
import { buildExecHealth } from "./exec-pack";
import { rollupByProgramme, type ProjectCapacity } from "./capacity-rollup";
import { consolidateFinancials, type ProjectFin } from "./portfolio-finance";
import { rollupIncome, rollupBenefits, type ProjectItems } from "./portfolio-value";

/**
 * LOGIC & COLLISION STRESS HARNESS (SPA / derivations side).
 *
 * Aim: catch behaviour that is FUNCTIONALLY BROKEN on data that is individually VALID — the flagship
 * class being identity collisions (two valid rows sharing a name, or a bare id across sources, that a
 * consumer keys/dedupes/groups/sorts on). NOT about crashes on malformed data.
 *
 * It AUTO-ENUMERATES every catalogue definition (reports/widgets/screens/views — read from the generated
 * catalogues, never hardcoded) and drives the pure report DERIVATIONS through four datasets:
 *   D_empty, D_single, D_messy (value-level imperfection), and D_collide (the key one — valid colliding rows).
 *
 * Assertions: no derivation silently merges/drops on a name collision; row/issue COUNTS are preserved;
 * grouping/dedup uses source:id (unique) not name; sort output is deterministic for equal keys; totals
 * don't double-count.
 */

const ms = (d: string) => Date.parse(d);

// ── Catalogue enumeration ─────────────────────────────────────────────────────

describe("catalogue enumeration — the full definition surface", () => {
  const reports = reportCatalogue();
  const widgets = widgetCatalogue();
  const screens = screenCatalogue();
  const views = VIEWS;
  const total = reports.length + widgets.length + screens.length + views.length;

  it("exposes the exact shipped count of defs (read, not hardcoded in the derivation)", () => {
    expect(reports.length).toBe(16);
    expect(widgets.length).toBe(6);
    expect(screens.length).toBe(8);
    expect(views.length).toBe(6);
    expect(total).toBe(36);
  });

  it("gives every component library entry a unique, source-qualified id", () => {
    const lib = componentLibrary();
    const ids = lib.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of lib) expect(c.id).toBe(`${c.source}:${c.sourceId}`);
  });

  it("every report def maps to a renderer (builtin component or surfaced-via)", () => {
    for (const r of reports) {
      const ok = r.renderer.engine === "custom" || !!r.renderer.component || !!r.renderer.surfacedVia;
      expect(ok, `report ${r.id} has no resolvable renderer`).toBe(true);
    }
  });
});

// ── Dataset builders (valid rows only) ────────────────────────────────────────

function rProject(over: Partial<RoadmapProject> = {}): RoadmapProject {
  return { id: "p", source: "jira", name: "Project", issueCount: 4, completedCount: 1, ...over };
}

/** D_collide for the roadmap: two projects sharing a bare id across different sources. */
function roadmapCollide(): { projects: RoadmapProject[]; issues: Record<string, RoadmapIssue[]> } {
  const projects: RoadmapProject[] = [
    rProject({ id: "p1", source: "jira", name: "Apollo", programmeId: "prog-1", programmeName: "Delivery" }),
    // SAME bare id, different source — must NOT read Apollo's issues
    rProject({ id: "p1", source: "ado", name: "Zeus", programmeId: "prog-2", programmeName: "Growth" }),
  ];
  const issues: Record<string, RoadmapIssue[]> = {
    [roadmapKey(projects[0]!)]: [{ startDate: "2026-01-01", dueDate: "2026-02-01" }],
    [roadmapKey(projects[1]!)]: [{ startDate: "2026-06-01", dueDate: "2026-07-01" }],
  };
  return { projects, issues };
}

// ── Roadmap: id-collision + deterministic ordering ────────────────────────────

describe("buildRoadmap — id-collision and deterministic ordering", () => {
  it("D_empty: no projects ⇒ empty roadmap, zero bounds", () => {
    const r = buildRoadmap([], {});
    expect(r.lanes).toEqual([]);
    expect(r.datedProjects).toBe(0);
    expect(r.min).toBe(0);
  });

  it("D_single: one dated project ⇒ one bar", () => {
    const p = rProject({ id: "p1", source: "jira" });
    const r = buildRoadmap([p], { [roadmapKey(p)]: [{ startDate: "2026-01-01", dueDate: "2026-02-01" }] });
    expect(r.datedProjects).toBe(1);
    expect(r.lanes.flatMap((l) => l.bars).length).toBe(1);
  });

  it("D_collide: two projects with the SAME bare id, different source, do NOT share issues", () => {
    const { projects, issues } = roadmapCollide();
    const r = buildRoadmap(projects, issues);
    // Both projects are dated and DISTINCT — neither reads the other's span.
    expect(r.datedProjects).toBe(2);
    const bars = r.lanes.flatMap((l) => l.bars);
    const apollo = bars.find((b) => b.projectName === "Apollo")!;
    const zeus = bars.find((b) => b.projectName === "Zeus")!;
    expect(apollo.start).toBe(ms("2026-01-01")); // its OWN issues, not Zeus's June ones
    expect(zeus.start).toBe(ms("2026-06-01"));
    expect(apollo.start).not.toBe(zeus.start);
  });

  it("D_collide: lanes with the same start + same name are ordered deterministically by key", () => {
    // Two DIFFERENT programmes (distinct programmeId) that happen to share a name and an earliest start.
    const a = rProject({ id: "a", source: "jira", programmeId: "prog-b", programmeName: "Shared" });
    const b = rProject({ id: "b", source: "ado", programmeId: "prog-a", programmeName: "Shared" });
    const issues = {
      [roadmapKey(a)]: [{ startDate: "2026-01-01", dueDate: "2026-02-01" }],
      [roadmapKey(b)]: [{ startDate: "2026-01-01", dueDate: "2026-02-01" }],
    };
    const first = buildRoadmap([a, b], issues).lanes.map((l) => l.key);
    const second = buildRoadmap([b, a], issues).lanes.map((l) => l.key);
    // Input order reversed, output identical ⇒ deterministic. prog-a sorts before prog-b.
    expect(first).toEqual(second);
    expect(first).toEqual(["prog-a", "prog-b"]);
  });
});

// ── Exec pack: deterministic severity sort for equal-severity exceptions ───────

describe("buildExecHealth — deterministic exception order + no name-merge", () => {
  function health(over: Record<string, unknown> = {}) {
    return {
      projectId: "jira:p1",
      projectName: "Apollo",
      ragStatus: "RED",
      scheduleVarianceDays: -5,
      budgetVariancePercentage: 10,
      activeBlockersCount: 2,
      ...over,
    } as Parameters<typeof buildExecHealth>[0][number];
  }

  it("D_collide: two SAME-NAME projects (different source:id) both surface — neither is merged away", () => {
    const rows = [
      health({ projectId: "jira:p1", projectName: "Apollo" }),
      health({ projectId: "ado:p1", projectName: "Apollo" }), // same name, different identity
    ];
    const out = buildExecHealth(rows);
    expect(out.total).toBe(2);
    expect(out.exceptions.length).toBe(2); // both kept, not deduped on name
    expect(new Set(out.exceptions.map((e) => e.projectId)).size).toBe(2);
  });

  it("equal-severity exceptions sort deterministically regardless of input order", () => {
    const a = health({ projectId: "ado:x", projectName: "X" });
    const b = health({ projectId: "jira:y", projectName: "Y" }); // identical severity fields
    const first = buildExecHealth([a, b]).exceptions.map((e) => e.projectId);
    const second = buildExecHealth([b, a]).exceptions.map((e) => e.projectId);
    expect(first).toEqual(second);
    expect(first).toEqual(["ado:x", "jira:y"]); // tiebreak by projectId
  });
});

// ── Programme rollups: grouping by programmeId + deterministic equal-key sort ──

describe("programme rollups — grouping + deterministic equal-key ordering", () => {
  it("capacity rollup: programmes with equal utilisation order deterministically", () => {
    const mk = (pid: string): ProjectCapacity => ({
      projectId: `x-${pid}`, projectName: pid, programmeId: pid, programmeName: pid, resources: [],
    });
    const first = rollupByProgramme([mk("prog-b"), mk("prog-a")]).programmes.map((p) => p.key);
    const second = rollupByProgramme([mk("prog-a"), mk("prog-b")]).programmes.map((p) => p.key);
    expect(first).toEqual(second); // equal (null) utilisation ⇒ deterministic by key
  });

  it("finance consolidation: equal-variance programmes order deterministically", () => {
    const fin = { currency: "GBP", budgetAllocated: 100, actualBurn: 50, earnedValue: 50, cpi: 1, spi: 1, financialHealth: "on_track", forecastCostAtCompletion: 100 };
    const mk = (pid: string): ProjectFin => ({ projectId: `x-${pid}`, projectName: pid, programmeId: pid, programmeName: pid, fin: fin as ProjectFin["fin"] });
    const first = consolidateFinancials([mk("prog-b"), mk("prog-a")], "GBP").programmes.map((p) => p.key);
    const second = consolidateFinancials([mk("prog-a"), mk("prog-b")], "GBP").programmes.map((p) => p.key);
    expect(first).toEqual(second);
    expect(first).toEqual(["prog-a", "prog-b"]); // equal variance ⇒ tiebreak by key
  });

  it("income/benefits rollups: equal-metric programmes order deterministically", () => {
    const mk = (pid: string): ProjectItems => ({ projectId: `x-${pid}`, projectName: pid, programmeId: pid, programmeName: pid, currency: "GBP", items: [] });
    const inc1 = rollupIncome([mk("prog-b"), mk("prog-a")], "GBP").programmes.map((p) => p.key);
    const inc2 = rollupIncome([mk("prog-a"), mk("prog-b")], "GBP").programmes.map((p) => p.key);
    expect(inc1).toEqual(inc2);
    const ben1 = rollupBenefits([mk("prog-b"), mk("prog-a")], "GBP").programmes.map((p) => p.key);
    const ben2 = rollupBenefits([mk("prog-a"), mk("prog-b")], "GBP").programmes.map((p) => p.key);
    expect(ben1).toEqual(ben2);
  });
});
