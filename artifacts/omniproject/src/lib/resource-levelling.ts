import type { ResourceCapacity } from "@workspace/api-client-react";
import { rollupByProgramme, STANDALONE_PROGRAMME_KEY, type ProjectCapacity, type CapacityRollup } from "./capacity-rollup";
import { numLoose as num } from "./num";

/**
 * Cross-programme / cross-border resource LEVELLING — the ACT-ON-IT layer on top of the existing
 * capacity roll-up (`rollupByProgramme`, which SHOWS contention at portfolio level). This module adds:
 *
 *   1. `levelPortfolio` — a per-PERSON view across every programme they're allocated to. The roll-up
 *      counts an over-allocation per ALLOCATION ROW (one project); a person split 60%/60% across two
 *      projects never trips that (each row is ≤100%) even though they're 120% loaded portfolio-wide.
 *      This sums a person's allocation across every project they touch — the number a PMO actually
 *      needs to spot a borrow/lend candidate — and flags spread across programme AND country
 *      boundaries so a manager sees who's contended and who has spare capacity to lend.
 *   2. `skillsSupplyDemand` — a simple skill/tag supply-vs-demand balance (supply = available hours
 *      declared under a skill tag, demand = assigned hours consuming it), portfolio-wide. Deliberately
 *      NOT a taxonomy system — `ResourceCapacity.skills` is a flat label list a backend may declare.
 *   3. `simulateMove` — a pure WHAT-IF (mirrors `resource-load.ts`'s `loadDeltas`: base vs scenario,
 *      nothing written back) that models shifting a slice of one resource's allocation from one
 *      project to another and reports the before/after `CapacityRollup` for BOTH the origin and
 *      destination programme, straight from `rollupByProgramme` — so "the impact of the move" is
 *      exactly the same over/under-allocation signal the roll-up already shows, just diffed.
 *
 * Data residency: a move is gated by `residencyGate`, which reuses the SAME allowed-region vocabulary
 * as `artifacts/api-server/src/lib/data-residency.ts` (surfaced non-admin-safe via
 * `Capabilities.residency`) rather than inventing a new check. Fail-closed, matching that module: once
 * residency enforcement is on, a resource with no declared country — or one outside the allowed set —
 * cannot be modelled for a move. Read-only surfacing (the levelling table itself) needs no extra gate:
 * the data already passed the broker/egress residency check to reach the read model at all; the NEW
 * risk this feature adds is specifically SUGGESTING a cross-border move, which is what's gated here.
 *
 * Pure and derive-only (nothing stored), like every module it builds on.
 */

/** One resource allocation, flattened out of `ProjectCapacity.resources` and tagged with its project +
 *  programme — the unit `levelPortfolio` groups by person and `simulateMove` moves between projects. */
export interface LevellingAllocation {
  resourceId: string;
  resourceName: string;
  role: string;
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  /** The resource's declared home country/region code, or null when the backend doesn't say. */
  country: string | null;
  skills: string[];
  allocationPercentage: number;
  assignedHours: number;
  availableHours: number;
}

/** Flatten `ProjectCapacity[]` (the roll-up's own input) into one row per resource-allocation. */
export function flattenAllocations(projects: ProjectCapacity[]): LevellingAllocation[] {
  const out: LevellingAllocation[] = [];
  for (const p of projects) {
    for (const r of p.resources) {
      out.push({
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        role: r.role,
        projectId: p.projectId,
        projectName: p.projectName,
        programmeId: p.programmeId,
        programmeName: p.programmeName,
        country: r.country ?? null,
        skills: r.skills ?? [],
        allocationPercentage: num(r.allocationPercentage),
        assignedHours: num(r.assignedHours),
        availableHours: num(r.availableHours),
      });
    }
  }
  return out;
}

// ── Per-person portfolio-wide levelling ───────────────────────────────────────

export interface PersonLevelling {
  resourceId: string;
  resourceName: string;
  role: string;
  allocations: LevellingAllocation[];
  /** Distinct non-null countries across this person's allocations — >1 signals a residency-sensitive spread. */
  countries: string[];
  /** Distinct programme keys (a project's programmeId, or the standalone sentinel) this person touches. */
  programmeKeys: string[];
  skills: string[];
  /** Summed across EVERY allocation — the portfolio-wide signal a per-project view can't show. */
  totalAllocationPercentage: number;
  totalAssignedHours: number;
  totalAvailableHours: number;
  /** > 2 distinct programmes/countries — the levelling-specific "spans a boundary" flag. */
  crossProgramme: boolean;
  crossCountry: boolean;
}

export interface PortfolioLevelling {
  people: PersonLevelling[];
  /** totalAllocationPercentage > 100 — a borrow candidate FROM (they need relief). */
  overAllocated: PersonLevelling[];
  /** totalAllocationPercentage < underThresholdPct AND they have declared availability — a lend candidate TO. */
  underAllocated: PersonLevelling[];
}

/** Group allocations by person and roll them up portfolio-wide. `underThresholdPct` (default 80, matching
 *  the roll-up's own healthy-utilisation band) is the ceiling below which a person is a lend candidate. */
export function levelPortfolio(projects: ProjectCapacity[], underThresholdPct = 80): PortfolioLevelling {
  const byPerson = new Map<string, LevellingAllocation[]>();
  for (const a of flattenAllocations(projects)) {
    const list = byPerson.get(a.resourceId) ?? [];
    list.push(a);
    byPerson.set(a.resourceId, list);
  }

  const people: PersonLevelling[] = [];
  for (const [resourceId, allocations] of byPerson) {
    const countries = [...new Set(allocations.map((a) => a.country).filter((c): c is string => c !== null))];
    const programmeKeys = [...new Set(allocations.map((a) => a.programmeId ?? STANDALONE_PROGRAMME_KEY))];
    const skills = [...new Set(allocations.flatMap((a) => a.skills))];
    const totalAllocationPercentage = allocations.reduce((s, a) => s + a.allocationPercentage, 0);
    const totalAssignedHours = allocations.reduce((s, a) => s + a.assignedHours, 0);
    const totalAvailableHours = allocations.reduce((s, a) => s + a.availableHours, 0);
    people.push({
      resourceId,
      resourceName: allocations[0]!.resourceName,
      role: allocations[0]!.role,
      allocations,
      countries,
      programmeKeys,
      skills,
      totalAllocationPercentage,
      totalAssignedHours,
      totalAvailableHours,
      crossProgramme: programmeKeys.length > 1,
      crossCountry: countries.length > 1,
    });
  }
  people.sort((a, b) => b.totalAllocationPercentage - a.totalAllocationPercentage || a.resourceName.localeCompare(b.resourceName));

  return {
    people,
    overAllocated: people.filter((p) => p.totalAllocationPercentage > 100),
    underAllocated: people.filter((p) => p.totalAllocationPercentage < underThresholdPct && p.totalAvailableHours > 0),
  };
}

// ── Skills supply vs demand ────────────────────────────────────────────────────

export interface SkillBalance {
  skill: string;
  /** Distinct resources declaring this skill tag. */
  supplyHeadcount: number;
  /** Summed available hours across resources declaring this skill — the capacity headroom. */
  supplyAvailableHours: number;
  /** Summed assigned hours across resources declaring this skill — the capacity already consumed. */
  demandAssignedHours: number;
  /** supply − demand, in hours; negative = the skill is over-subscribed. */
  balanceHours: number;
  pressure: "shortage" | "surplus" | "balanced";
}

function pressureOf(supply: number, demand: number): SkillBalance["pressure"] {
  if (demand > supply) return "shortage";
  if (demand < supply * 0.5) return "surplus";
  return "balanced";
}

/** Supply (available hours) vs demand (assigned hours) per declared skill tag, portfolio-wide. Resources
 *  with no declared skills contribute to no row — the view is empty until a backend declares skills. */
export function skillsSupplyDemand(projects: ProjectCapacity[]): SkillBalance[] {
  const bySkill = new Map<string, { heads: Set<string>; supply: number; demand: number }>();
  for (const a of flattenAllocations(projects)) {
    for (const skill of a.skills) {
      const row = bySkill.get(skill) ?? { heads: new Set<string>(), supply: 0, demand: 0 };
      row.heads.add(a.resourceId);
      row.supply += a.availableHours;
      row.demand += a.assignedHours;
      bySkill.set(skill, row);
    }
  }
  return [...bySkill.entries()]
    .map(([skill, r]) => ({
      skill,
      supplyHeadcount: r.heads.size,
      supplyAvailableHours: r.supply,
      demandAssignedHours: r.demand,
      balanceHours: Math.round((r.supply - r.demand) * 10) / 10,
      pressure: pressureOf(r.supply, r.demand),
    }))
    .sort((a, b) => a.balanceHours - b.balanceHours || a.skill.localeCompare(b.skill)); // shortages first
}

// ── Data-residency gate for a modelled move ───────────────────────────────────

/** The non-sensitive residency posture `Capabilities.residency` carries — see data-residency.ts. */
export interface ResidencyPosture {
  enabled: boolean;
  allowedRegions: readonly string[];
}

export interface ResidencyVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Is it OK to model a move for a resource declaring `country`? Mirrors `checkResidency`'s fail-closed
 * shape in `artifacts/api-server/src/lib/data-residency.ts` — the SAME allowed-region set, just applied
 * to a resource's own declared country instead of a broker endpoint's region:
 *   - Enforcement off (`!posture.enabled`) ⇒ always allowed (behaviour-preserving default).
 *   - A resource with NO declared country, while enforcement is on ⇒ refused — an unprovable region
 *     can't be trusted (exactly data-residency.ts's rationale for an undeclared endpoint region).
 *   - A declared country outside the allowed set ⇒ refused.
 * This governs the modelled MOVE only (the write-adjacent what-if); read-only surfacing of a resource
 * needs no extra gate here because it already passed the broker/egress residency check to be in the
 * read model at all.
 */
export function residencyGate(country: string | null, posture: ResidencyPosture): ResidencyVerdict {
  if (!posture.enabled) return { allowed: true };
  if (country === null) return { allowed: false, reason: "resource has no declared country — cannot prove residency (fail-closed)" };
  const allow = new Set(posture.allowedRegions.map((r) => r.toLowerCase()));
  if (!allow.has(country.toLowerCase())) {
    return { allowed: false, reason: `resource's country '${country}' is not in the allowed region set {${[...allow].join(", ")}}` };
  }
  return { allowed: true };
}

// ── Move / scenario what-if ────────────────────────────────────────────────────

export interface MoveInput {
  resourceId: string;
  fromProjectId: string;
  toProjectId: string;
  /** Percentage points of the resource's allocation to shift from the origin project to the destination. */
  movePercentage: number;
}

/** Before/after `CapacityRollup` for one programme side of a move, plus the derived deltas a UI reads directly. */
export interface MoveSideDelta {
  programmeId: string | null;
  before: CapacityRollup;
  after: CapacityRollup;
  overAllocatedDelta: number;
  utilisationDelta: number | null;
}

export interface MoveResult {
  resourceId: string;
  resourceName: string;
  movePercentage: number;
  allowed: boolean;
  reason?: string;
  from: MoveSideDelta;
  to: MoveSideDelta;
}

function rowFor(rollup: { programmes: CapacityRollup[] }, programmeId: string | null): CapacityRollup {
  const key = programmeId ?? STANDALONE_PROGRAMME_KEY;
  const row = rollup.programmes.find((p) => p.key === key);
  // rollupByProgramme always creates a group for every project it folds, so this can only miss when the
  // programme has no projects in the input at all (e.g. the caller passed a stale id) — degrade to a blank row.
  return row ?? { key, label: programmeId ?? "Standalone", projects: 0, allocations: 0, overAllocated: 0, assignedHours: 0, availableHours: 0, utilisation: null };
}

function sideDelta(before: { programmes: CapacityRollup[] }, after: { programmes: CapacityRollup[] }, programmeId: string | null): MoveSideDelta {
  const b = rowFor(before, programmeId);
  const a = rowFor(after, programmeId);
  return {
    programmeId,
    before: b,
    after: a,
    overAllocatedDelta: a.overAllocated - b.overAllocated,
    utilisationDelta: a.utilisation === null || b.utilisation === null ? null : Math.round((a.utilisation - b.utilisation) * 10) / 10,
  };
}

/**
 * WHAT-IF: model moving `movePercentage` points of a resource's allocation from `fromProjectId` to
 * `toProjectId`, and report the before/after `CapacityRollup` (from `rollupByProgramme`, reused not
 * rebuilt) for both programmes. Pure — never writes back to the broker. Blocked (allowed: false, before
 * === after) when the resource isn't found on the origin project or `residencyGate` refuses the move.
 */
export function simulateMove(projects: ProjectCapacity[], move: MoveInput, posture: ResidencyPosture): MoveResult {
  const before = rollupByProgramme(projects);
  const fromProject = projects.find((p) => p.projectId === move.fromProjectId);
  const toProject = projects.find((p) => p.projectId === move.toProjectId);
  const origin = fromProject?.resources.find((r) => r.resourceId === move.resourceId);

  const blocked = (reason: string, resourceName = origin?.resourceName ?? move.resourceId): MoveResult => ({
    resourceId: move.resourceId,
    resourceName,
    movePercentage: move.movePercentage,
    allowed: false,
    reason,
    from: sideDelta(before, before, fromProject?.programmeId ?? null),
    to: sideDelta(before, before, toProject?.programmeId ?? null),
  });

  if (!fromProject) return blocked(`origin project '${move.fromProjectId}' not found`);
  if (!toProject) return blocked(`destination project '${move.toProjectId}' not found`);
  if (!origin) return blocked(`resource '${move.resourceId}' is not allocated on the origin project`);

  const gate = residencyGate(origin.country ?? null, posture);
  if (!gate.allowed) return blocked(gate.reason ?? "blocked by the data-residency policy", origin.resourceName);

  const movePct = Math.max(0, Math.min(move.movePercentage, origin.allocationPercentage));
  const movedHours = origin.availableHours > 0 ? (movePct / 100) * origin.availableHours : 0;

  const scenario: ProjectCapacity[] = projects.map((p) => {
    if (p.projectId === move.fromProjectId) {
      return {
        ...p,
        resources: p.resources.map((r) => (r.resourceId !== move.resourceId ? r : {
          ...r,
          allocationPercentage: Math.max(0, num(r.allocationPercentage) - movePct),
          assignedHours: Math.max(0, num(r.assignedHours) - movedHours),
        })),
      };
    }
    if (p.projectId === move.toProjectId) {
      const existing = p.resources.find((r) => r.resourceId === move.resourceId);
      const resources = existing
        ? p.resources.map((r) => (r.resourceId !== move.resourceId ? r : {
            ...r,
            allocationPercentage: num(r.allocationPercentage) + movePct,
            assignedHours: num(r.assignedHours) + movedHours,
          }))
        : [...p.resources, {
            resourceId: origin.resourceId,
            resourceName: origin.resourceName,
            role: origin.role,
            allocationPercentage: movePct,
            assignedHours: movedHours,
            availableHours: origin.availableHours,
            utilizationState: origin.utilizationState,
            country: origin.country ?? null,
            skills: origin.skills ?? [],
          } satisfies ResourceCapacity];
      return { ...p, resources };
    }
    return p;
  });

  const after = rollupByProgramme(scenario);
  return {
    resourceId: move.resourceId,
    resourceName: origin.resourceName,
    movePercentage: movePct,
    allowed: true,
    from: sideDelta(before, after, fromProject.programmeId),
    to: sideDelta(before, after, toProject.programmeId),
  };
}
