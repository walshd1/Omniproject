import type { DrillTo, DrillToCondition, DrillToFieldCondition } from "@workspace/backend-catalogue";
import { safeParseJson } from "./safe-json";
import type { ConditionSet, Predicate, Op } from "./rate-card";

/**
 * The SPA drill-down resolver (backlog #122): turns a `DrillTo` descriptor — declared on a report/widget
 * definition, see @workspace/backend-catalogue's drill-to.ts — plus the SPECIFIC data point a user
 * clicked (a portfolio-health row, an exec-pack exception row, …) into a concrete navigation target: the
 * work-item grid, pre-filtered. Composes with the SAME predicate shape (`ConditionSet`/`Predicate`)
 * already used by the rate-card cost rules and the custom report engine (custom-report.ts `matchRow`),
 * so the grid applies a drill-through filter with the exact same engine it already runs saved filters
 * through — no second filter language.
 *
 * Nothing here is persisted: the filter travels as `filter`/`filterLabel` query params on the navigation
 * itself (IssueGrid.tsx reads them back via wouter's `useSearchParams`), so a drill-through is just
 * client-side navigation + URL state — no broker round-trip, nothing at rest.
 */

export interface ResolvedDrillTo {
  /** A wouter href to navigate to: the grid, pre-filtered. */
  href: string;
  /** The resolved predicate (exposed directly for callers/tests that don't need the href). */
  predicate: ConditionSet;
  /** Human label for the filter — the descriptor's own `label`, or an auto-summary of the predicate. */
  label: string;
}

const QUERY_FILTER = "filter";
const QUERY_LABEL = "filterLabel";
/** The query param names `resolveDrillTo`/`readDrillFilter` round-trip through — exported so a caller
 *  can clear just the drill state (IssueGrid's "Clear filter") without hardcoding param names twice. */
export const DRILL_FILTER_PARAMS = [QUERY_FILTER, QUERY_LABEL] as const;

/** Turn one declarative condition into a real `Predicate`, resolving `fromField` against the clicked
 *  row. Returns null when a row-derived condition has nothing to read (the row lacks that field) —
 *  the caller then abandons the whole drill-through rather than filtering on `undefined`. */
function toPredicate(c: DrillToFieldCondition, row: Record<string, unknown>): Predicate | null {
  const value = c.fromField ? row[c.fromField] : c.value;
  if (c.fromField && (value === undefined || value === null)) return null;
  return value === undefined ? { field: c.field, op: c.op as Op } : { field: c.field, op: c.op as Op, value };
}

function mergeConditionSet(
  base: DrillTo["predicate"],
  fromRow: DrillToFieldCondition[] | undefined,
  row: Record<string, unknown>,
): ConditionSet | null {
  const all: Predicate[] = (base?.all ?? []).map((c: DrillToCondition) => ({ field: c.field, op: c.op as Op, ...(c.value !== undefined ? { value: c.value } : {}) }));
  for (const c of fromRow ?? []) {
    const p = toPredicate(c, row);
    if (!p) return null; // a row-derived condition couldn't resolve — don't produce a bogus filter
    all.push(p);
  }
  const any: Predicate[] = (base?.any ?? []).map((c: DrillToCondition) => ({ field: c.field, op: c.op as Op, ...(c.value !== undefined ? { value: c.value } : {}) }));
  if (all.length === 0 && any.length === 0) return null; // nothing to filter on — not a real drill-down
  const out: ConditionSet = {};
  if (all.length) out.all = all;
  if (any.length) out.any = any;
  return out;
}

/** A short, readable fallback summary of a predicate ("blocked", "status = done") for a descriptor that
 *  doesn't declare its own `label`. */
function summarise(predicate: ConditionSet): string {
  const describe = (p: Predicate): string => {
    switch (p.op) {
      case "truthy": return p.field;
      case "falsy": return `not ${p.field}`;
      case "eq": return `${p.field} = ${String(p.value)}`;
      case "ne": return `${p.field} ≠ ${String(p.value)}`;
      case "in": return `${p.field} in ${String(p.value)}`;
      case "nin": return `${p.field} not in ${String(p.value)}`;
      default: return `${p.field} ${p.op}${p.value !== undefined ? ` ${String(p.value)}` : ""}`;
    }
  };
  const parts = (predicate.all ?? []).map(describe);
  const anyParts = (predicate.any ?? []).map(describe);
  if (anyParts.length) parts.push(`(${anyParts.join(" or ")})`);
  return parts.join(" and ") || "filtered";
}

/** Resolve a `drillTo` descriptor against the SPECIFIC data point clicked. Returns null when the
 *  descriptor can't produce a real filter for this row (no resolvable project id, no resolvable
 *  conditions) — callers should render a plain, non-clickable figure in that case rather than a dead
 *  link (e.g. "0 blocked" has nothing to drill into). */
export function resolveDrillTo(drillTo: DrillTo, row: Record<string, unknown>): ResolvedDrillTo | null {
  if (drillTo.target !== "grid") return null;

  const projectId = drillTo.projectIdField ? row[drillTo.projectIdField] : undefined;
  if (drillTo.projectIdField && (projectId == null || projectId === "")) return null;

  const predicate = mergeConditionSet(drillTo.predicate, drillTo.predicateFrom, row);
  if (!predicate) return null;

  const label = drillTo.label ?? summarise(predicate);
  const params = new URLSearchParams();
  params.set(QUERY_FILTER, JSON.stringify(predicate));
  params.set(QUERY_LABEL, label);
  const base = projectId != null ? `/projects/${encodeURIComponent(String(projectId))}` : "/projects";
  return { href: `${base}?${params.toString()}`, predicate, label };
}

/**
 * Two more "red number → grid" descriptors (backlog #132), built here in code rather than declared in
 * a catalogue JSON asset like portfolioHealth's static `blocked truthy` (backlog #122): the population
 * they filter to depends on today's date / doesn't reduce to a fixed literal, so they can't be
 * authored once and reused verbatim. Both still go through the SAME `resolveDrillTo` resolver as every
 * other drillTo — only the descriptor's origin (code vs. JSON) differs.
 */

/** Drill-through for a project's overdue, still-open work items — the schedule-variance / "exceptions"
 *  figure across the exec board pack, portfolio KPI cards and the PRINCE2 highlight report all resolve
 *  through this ONE descriptor. `asOf` defaults to now but is exposed so callers/tests can pin the
 *  clock instead of asserting against a moving target. Mirrors `isOverdue` in methodology.ts (dueDate
 *  in the past, status not done/cancelled) using the SAME predicate engine the grid filters with. */
export function overdueDrillTo(asOf: Date = new Date()): DrillTo {
  return {
    target: "grid",
    projectIdField: "projectId",
    predicate: {
      all: [
        { field: "dueDate", op: "lt", value: asOf.toISOString().slice(0, 10) },
        { field: "status", op: "nin", value: ["done", "cancelled"] },
      ],
    },
    label: "Overdue items",
  };
}

/** Drill-through for a project's cost-incurring work items — the budget-variance figure's drill-through.
 *  Filters to items with actual cost logged against them (the population behind a budget overrun),
 *  reusing the SAME resolver as `overdueDrillTo`/portfolioHealth's blockers descriptor. */
export function costOverrunDrillTo(): DrillTo {
  return {
    target: "grid",
    projectIdField: "projectId",
    predicate: { all: [{ field: "actualCost", op: "gt", value: 0 }] },
    label: "Cost-incurring items",
  };
}

export interface ActiveDrillFilter {
  predicate: ConditionSet;
  label: string;
}

/** Read a drill-through filter back off the URL — the other half of the round trip `resolveDrillTo`
 *  writes, consumed by IssueGrid. Returns null when absent or unparsable (a malformed/tampered query
 *  string degrades to "no filter" rather than throwing). */
export function readDrillFilter(params: URLSearchParams): ActiveDrillFilter | null {
  const raw = params.get(QUERY_FILTER);
  if (!raw) return null;
  try {
    const predicate = safeParseJson(raw);
    if (typeof predicate !== "object" || predicate === null || Array.isArray(predicate)) return null;
    const label = params.get(QUERY_LABEL) ?? summarise(predicate as ConditionSet);
    return { predicate: predicate as ConditionSet, label };
  } catch {
    return null;
  }
}
