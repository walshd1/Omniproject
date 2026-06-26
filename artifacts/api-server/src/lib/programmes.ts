import type { Row } from "./data";

/**
 * Programmes are a grouping of related projects, **derived** from each project's
 * optional `programmeId` (owned by the backend). OmniProject stores nothing — it
 * groups and rolls up. Consequences of deriving from membership:
 *   - a programme exists only when ≥ 1 project references it (the invariant);
 *   - projects without a programmeId are standalone (not in any programme).
 * Pure functions so they're unit-tested.
 */

/**
 * Programme-wide financial roll-up, summed from member projects' denormalised
 * financial fields (the same pattern as issueCount). Amounts are in the native
 * currency the backend reports; the SPA converts to a display currency via FX.
 * `null` when no member project carries financial data — so it only ever shows
 * for backends with a finance source (capability-gated end to end).
 */
export interface ProgrammeFinancials {
  currency: string;
  /** Σ project budgets. */
  budget: number;
  /** Σ actual cost / burn. */
  actualCost: number;
  /** Σ earned value, when every contributing project reports it; else null. */
  earnedValue: number | null;
  /** Σ committed / purchase-order cost, when reported; else null. */
  committed: number | null;
  /** Cost performance index (earnedValue / actualCost), when known. */
  cpi: number | null;
  /** budget − actualCost (native currency). */
  variance: number;
  /** Rounded percentage variance against budget, when budget > 0. */
  variancePct: number | null;
  health: "GREEN" | "AMBER" | "RED";
  /** How many member projects contributed financial figures. */
  projectsCounted: number;
  /**
   * Per-metric reporting coverage, so the UI can show "12 of 15 reporting"
   * inline instead of silently hiding a metric that only some projects supply.
   */
  reporting: {
    /** All member projects (the honest denominator for portfolio coverage). */
    total: number;
    /** Projects carrying any financials (budget/actualCost) — = projectsCounted. */
    costed: number;
    /** Of the costed projects, how many reported earned value. */
    earnedValue: number;
    /** Of the costed projects, how many reported committed/PO cost. */
    committed: number;
  };
}

export interface ProgrammeRollup {
  id: string;
  name: string;
  projectCount: number;
  issueCount: number;
  completedCount: number;
  completionRate: number;
  ragStatus: "GREEN" | "AMBER" | "RED";
  updatedAt: string | null;
  /** Present only when ≥1 member project carries financial data. */
  financials?: ProgrammeFinancials | null;
}

export interface ProgrammeDetail extends ProgrammeRollup {
  projects: Row[];
}

function ragFor(completionRate: number): "GREEN" | "AMBER" | "RED" {
  if (completionRate >= 60) return "GREEN";
  if (completionRate >= 25) return "AMBER";
  return "RED";
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A finite number from a row field, or null when the field is absent/non-numeric. */
function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const financialHealth = (cpi: number | null, budget: number, actualCost: number): "GREEN" | "AMBER" | "RED" => {
  // Prefer cost-performance when earned value is known; else fall back to the
  // spend ratio against budget.
  if (cpi !== null) return cpi < 0.9 ? "RED" : cpi < 1 ? "AMBER" : "GREEN";
  if (budget <= 0) return "GREEN";
  const ratio = actualCost / budget;
  return ratio > 1 ? "RED" : ratio >= 0.9 ? "AMBER" : "GREEN";
};

/**
 * Sum member projects' denormalised financial fields. Returns null when no
 * project carries any financial figure (budget/actualCost) — the signal the UI
 * uses to hide financials entirely for non-finance backends. `earnedValue` and
 * `committed` roll up only when EVERY contributing project reports them, so a
 * partial figure is never presented as complete.
 */
export function aggregateFinancials(projects: Row[]): ProgrammeFinancials | null {
  let budget = 0;
  let actualCost = 0;
  let evSum = 0;
  let committedSum = 0;
  let evAll = true;
  let committedAll = true;
  let counted = 0;
  let evCount = 0;
  let committedCount = 0;
  let currency = "";
  for (const p of projects) {
    const b = optNum(p["budget"]);
    const a = optNum(p["actualCost"]);
    if (b === null && a === null) continue; // no financials on this project
    counted++;
    budget += b ?? 0;
    actualCost += a ?? 0;
    const ev = optNum(p["earnedValue"]);
    if (ev === null) evAll = false; else { evSum += ev; evCount++; }
    const committed = optNum(p["committed"]);
    if (committed === null) committedAll = false; else { committedSum += committed; committedCount++; }
    const c = p["currency"];
    if (!currency && typeof c === "string" && c) currency = c;
  }
  if (counted === 0) return null;
  const earnedValue = evAll ? evSum : null;
  const committed = committedAll ? committedSum : null;
  const cpi = earnedValue !== null && actualCost > 0 ? Math.round((earnedValue / actualCost) * 100) / 100 : null;
  const variance = budget - actualCost;
  return {
    currency: currency || "GBP",
    budget,
    actualCost,
    earnedValue,
    committed,
    cpi,
    variance,
    variancePct: budget > 0 ? Math.round((variance / budget) * 100) : null,
    health: financialHealth(cpi, budget, actualCost),
    projectsCounted: counted,
    reporting: { total: projects.length, costed: counted, earnedValue: evCount, committed: committedCount },
  };
}

function summarise(id: string, projects: Row[]): ProgrammeRollup {
  let issueCount = 0;
  let completedCount = 0;
  let name = id;
  let updatedAt: string | null = null;
  for (const p of projects) {
    issueCount += num(p["issueCount"]);
    completedCount += num(p["completedCount"]);
    const pn = p["programmeName"];
    if (typeof pn === "string" && pn) name = pn;
    const u = p["updatedAt"];
    if (typeof u === "string" && (!updatedAt || u > updatedAt)) updatedAt = u;
  }
  const completionRate = issueCount > 0 ? Math.round((completedCount / issueCount) * 100) : 0;
  return {
    id, name, projectCount: projects.length, issueCount, completedCount, completionRate,
    ragStatus: ragFor(completionRate), updatedAt,
    financials: aggregateFinancials(projects),
  };
}

function programmeIdOf(p: Row): string | null {
  const v = p["programmeId"];
  return typeof v === "string" && v ? v : null;
}

/** Group projects into programmes (standalone projects are excluded). */
export function groupProgrammes(projects: Row[]): ProgrammeRollup[] {
  const groups = new Map<string, Row[]>();
  for (const p of projects) {
    const id = programmeIdOf(p);
    if (!id) continue;
    const list = groups.get(id) ?? [];
    list.push(p);
    groups.set(id, list);
  }
  return [...groups.entries()].map(([id, ps]) => summarise(id, ps)).sort((a, b) => a.name.localeCompare(b.name));
}

/** A programme's roll-up + its member projects, or null if it has none. */
export function programmeDetail(projects: Row[], id: string): ProgrammeDetail | null {
  const members = projects.filter((p) => programmeIdOf(p) === id);
  if (members.length === 0) return null;
  return { ...summarise(id, members), projects: members };
}

/** Count of projects not in any programme (for the UI's "standalone" section). */
export function standaloneCount(projects: Row[]): number {
  return projects.filter((p) => !programmeIdOf(p)).length;
}
