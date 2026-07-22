import type { Row } from "./data";
import type { TaskSummary } from "./task-summary";
import { type RagStatus, ragFor, financialHealthFrom } from "../broker/vocabulary";
import { numLoose as num, optNum } from "@workspace/backend-catalogue";

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
  health: RagStatus;
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
  ragStatus: RagStatus;
  updatedAt: string | null;
  /** Present only when ≥1 member project carries financial data. */
  financials?: ProgrammeFinancials | null;
}

export interface ProgrammeDetail extends ProgrammeRollup {
  projects: Row[];
  /** GTD task roll-up across this programme's projects, or null when the backend models no tasks.
   *  Folded in by the route (the pure rollup stays over project rows only). */
  tasks?: TaskSummary | null;
}

/**
 * Sum member projects' denormalised financial fields. Returns null when no
 * project carries any financial figure (budget/actualCost) — the signal the UI
 * uses to hide financials entirely for non-finance backends. `earnedValue` and
 * `committed` roll up only when EVERY contributing project reports them, so a
 * partial figure is never presented as complete.
 */
/** The non-empty currency shared by the MOST cost-bearing projects (tie → first seen), or "" when
 *  none declare one. This is the programme's native currency; summing a project in a DIFFERENT
 *  currency into the same total would add a raw foreign amount and mislabel it (and the SPA converts
 *  FROM this single native currency, so it must be single-currency) — such projects are excluded. */
function dominantCurrency(projects: Row[]): string {
  const count = new Map<string, number>();
  const order: string[] = [];
  for (const p of projects) {
    if (optNum(p["budget"]) === null && optNum(p["actualCost"]) === null) continue;
    const c = p["currency"];
    if (typeof c === "string" && c) {
      if (!count.has(c)) order.push(c);
      count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  let native = "";
  let best = 0;
  for (const c of order) {
    const n = count.get(c)!;
    if (n > best) { best = n; native = c; }
  }
  return native;
}

/** Sum a programme's project financials into one rollup (budget, actual cost, variance, …), or null
 *  when none of the projects carry any financial fields (nothing to report). */
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
  // Pick ONE native currency and sum only projects that match it (an empty/absent currency is assumed
  // to already be native). A project in another currency is excluded from this native total — never
  // raw-summed — and so isn't counted as `costed` (the reporting badge then shows partial coverage).
  const currency = dominantCurrency(projects);
  for (const p of projects) {
    const b = optNum(p["budget"]);
    const a = optNum(p["actualCost"]);
    if (b === null && a === null) continue; // no financials on this project
    const c = p["currency"];
    const cur = typeof c === "string" && c ? c : "";
    if (currency && cur && cur !== currency) continue; // different currency — can't fold into the native total
    counted++;
    budget += b ?? 0;
    actualCost += a ?? 0;
    const ev = optNum(p["earnedValue"]);
    if (ev === null) evAll = false; else { evSum += ev; evCount++; }
    const committed = optNum(p["committed"]);
    if (committed === null) committedAll = false; else { committedSum += committed; committedCount++; }
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
    health: financialHealthFrom(cpi, budget, actualCost),
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

/** A project's backend-owned `programmeId`, if any. Retained for governance scope-ownership; programme
 *  MEMBERSHIP no longer derives from it (see the registry below). */
export function programmeIdOf(p: Row): string | null {
  const v = p["programmeId"];
  return typeof v === "string" && v ? v : null;
}

/**
 * The PROGRAMME REGISTRY — the admin/PMO-managed source of truth for programmes. Each programme has a
 * human-readable `name` chosen by an admin/PMO, and a list of project correlation GUIDs (`omniInstanceId`)
 * that belong to it. Membership is defined ENTIRELY by GUID: a project is in a programme iff its GUID is
 * in that programme's list. Backend-independent (works across backends, and even for backends that know
 * nothing of programmes), because the GUID is OmniProject's own correlation key.
 */
export interface ProgrammeDef {
  /** The admin/PMO-chosen display name. */
  name: string;
  /** Project correlation GUIDs (`omniInstanceId`) that belong to this programme. */
  instanceIds: string[];
}
export type ProgrammeRegistry = Record<string, ProgrammeDef>;

export class ProgrammeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgrammeRegistryError";
  }
}

/** Validate + normalise the programme registry (trims, defaults name to the id, dedupes GUIDs). */
export function validateProgrammeRegistry(value: unknown): ProgrammeRegistry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProgrammeRegistryError("programmeRegistry must be an object of programmeId → { name, instanceIds }");
  }
  const out: ProgrammeRegistry = {};
  for (const [rawId, def] of Object.entries(value)) {
    const id = rawId.trim();
    if (!id) throw new ProgrammeRegistryError("programme id must be non-empty");
    if (!def || typeof def !== "object" || Array.isArray(def)) throw new ProgrammeRegistryError(`programme "${id}" must be an object { name, instanceIds }`);
    const d = def as Record<string, unknown>;
    const rawName = typeof d["name"] === "string" ? (d["name"] as string).trim() : "";
    const rawIds = d["instanceIds"];
    if (!Array.isArray(rawIds)) throw new ProgrammeRegistryError(`programme "${id}" needs an instanceIds array`);
    out[id] = {
      name: rawName || id,
      instanceIds: [...new Set(rawIds.map((g) => (typeof g === "string" ? g.trim() : "")).filter(Boolean))],
    };
  }
  return out;
}

/** The correlation GUID of a project row, or "" when absent. */
function instanceIdOf(p: Row): string {
  return typeof p["omniInstanceId"] === "string" ? (p["omniInstanceId"] as string) : "";
}

/**
 * Every programme id a project belongs to — determined SOLELY by its correlation GUID against the
 * registry's lists. A project can belong to more than one programme (its GUID may appear in several).
 */
export function programmeIdsOf(p: Row, registry: ProgrammeRegistry = {}): string[] {
  const guid = instanceIdOf(p);
  if (!guid) return [];
  return Object.entries(registry).filter(([, def]) => def.instanceIds.includes(guid)).map(([id]) => id);
}

/** Invert the registry into `guid → programme ids` ONCE, so a per-project lookup is O(1) instead of a
 *  full registry scan. Ids are pushed in registry-iteration order, so a project's programme list is
 *  byte-identical to the old per-project `Object.entries(registry).filter(...)`. */
function membershipByGuid(registry: ProgrammeRegistry): Map<string, string[]> {
  const byGuid = new Map<string, string[]>();
  for (const [id, def] of Object.entries(registry)) {
    for (const guid of def.instanceIds) {
      const ids = byGuid.get(guid);
      if (ids) ids.push(id); else byGuid.set(guid, [id]);
    }
  }
  return byGuid;
}

/** Group projects into programmes by the registry (standalone projects are excluded). Programme names
 *  come from the registry (admin/PMO-chosen), not from any backend field. */
export function groupProgrammes(projects: Row[], registry: ProgrammeRegistry = {}): ProgrammeRollup[] {
  // Invert the registry once (O(memberships)) so grouping is O(projects), not O(projects × programmes).
  const byGuid = membershipByGuid(registry);
  const groups = new Map<string, Row[]>();
  for (const p of projects) {
    const guid = instanceIdOf(p);
    if (!guid) continue;
    for (const id of byGuid.get(guid) ?? []) {
      const list = groups.get(id) ?? [];
      list.push(p);
      groups.set(id, list);
    }
  }
  return [...groups.entries()]
    .map(([id, ps]) => ({ ...summarise(id, ps), name: registry[id]?.name || id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** A programme's roll-up + its member projects, or null if it has none. */
export function programmeDetail(projects: Row[], id: string, registry: ProgrammeRegistry = {}): ProgrammeDetail | null {
  const members = projects.filter((p) => programmeIdsOf(p, registry).includes(id));
  if (members.length === 0) return null;
  return { ...summarise(id, members), name: registry[id]?.name || id, projects: members };
}

/** Count of projects not in any programme (for the UI's "standalone" section). */
export function standaloneCount(projects: Row[], registry: ProgrammeRegistry = {}): number {
  return projects.filter((p) => programmeIdsOf(p, registry).length === 0).length;
}
