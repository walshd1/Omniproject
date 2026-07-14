import { AsyncLocalStorage } from "node:async_hooks";
import type { Broker, Row, PortfolioRow, HistoryPoint, Project, Issue } from "./types";

/**
 * Broker READ sanitizer — the production seam that keeps malformed backend data out of the gateway's
 * derivations and off the frontend. It sits closest to the real broker (below every other read wrapper),
 * so a value repaired here is repaired ONCE and cache/provenance/scope/gateway/frontend all see clean,
 * contract-shaped data. This is the single normalization point that replaces the ad-hoc, easy-to-forget
 * `num()`/`numLoose()` coercion each consumer used to hand-roll (the source of the dirty-data bug class).
 *
 * Policy: FAIL-SOFT REPAIR — a junk number becomes a safe default (0 for a required figure, null for an
 * optional one), a missing required string becomes "", never throwing and never dropping the record — the
 * app's graceful-degradation stance. Every repair of a PRESENT-but-invalid value is TALLIED (a legitimately
 * absent optional field is not a repair) so the count can be surfaced as a data-quality signal (see
 * `runWithDataQuality`) — the operator sees when a backend is feeding dirty data.
 *
 * It is the production inverse of the dev-only messy-broker (which INJECTS the same imperfections); the
 * two share the read-method set, and the test suite sanitizes messy output to prove conformance holds.
 */

// ── Per-request data-quality tally ──────────────────────────────────────────────────────────────────
interface Tally { repaired: number; dropped: number }
const scope = new AsyncLocalStorage<Tally>();

/** Run `fn` with a fresh data-quality tally in scope; returns the fn result AND the accumulated tally,
 *  so a request handler can surface "N fields repaired / M rows dropped" for this response. */
export async function runWithDataQuality<T>(fn: () => Promise<T>): Promise<{ result: T; quality: Tally }> {
  const tally: Tally = { repaired: 0, dropped: 0 };
  const result = await scope.run(tally, fn);
  return { result, quality: tally };
}
/** Establish a fresh data-quality tally for the (possibly async) work `fn` starts — the request-
 *  middleware entry point. `fn` runs synchronously; the tally stays in scope for every async broker
 *  read it spawns, so the sanitizer counts repairs for the whole request. */
export function withDataQualityScope(fn: () => void): void {
  scope.run({ repaired: 0, dropped: 0 }, fn);
}
/** The active tally, or undefined outside a data-quality scope (the sanitizer still repairs; it just
 *  doesn't count). */
export function currentDataQuality(): Readonly<Tally> | undefined {
  return scope.getStore();
}
function markRepair(): void { const t = scope.getStore(); if (t) t.repaired += 1; }

// ── Field coercions (each records a repair only when a PRESENT value was invalid) ────────────────────
/** A required finite number — a junk/absent value repairs to 0. */
function reqNum(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  markRepair();
  return 0;
}
/** An optional finite number — absent stays null (not a repair); a present junk value repairs to null. */
function optNum(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  markRepair();
  return null;
}
/** A required string — a non-string repairs to "" (or its String() form for a primitive). */
function reqStr(raw: unknown): string {
  if (typeof raw === "string") return raw;
  markRepair();
  return raw === null || raw === undefined ? "" : String(raw);
}
/** An optional boolean — absent stays null; a truthy/falsy non-bool repairs to its Boolean() form. */
function optBool(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "boolean") return raw;
  markRepair();
  return Boolean(raw);
}

// ── Per-type sanitizers — repair the KNOWN contract fields, pass the rest of the Row through ─────────
/** PortfolioRow: all three variance/blocker figures are required numbers (the ones that poisoned the
 *  KPI roll-ups to NaN when a backend fed junk). */
export function sanitizePortfolioRow(r: Row): PortfolioRow {
  return {
    ...r,
    projectId: reqStr(r["projectId"]),
    projectName: reqStr(r["projectName"]),
    ragStatus: reqStr(r["ragStatus"]),
    scheduleVarianceDays: reqNum(r["scheduleVarianceDays"]),
    budgetVariancePercentage: reqNum(r["budgetVariancePercentage"]),
    activeBlockersCount: reqNum(r["activeBlockersCount"]),
  };
}

const PROVENANCE = new Set(["sourced", "derived", "sample"]);
/** HistoryPoint: numeric counts + a fixed provenance enum (unknown vocab → "sourced", the neutral default). */
export function sanitizeHistoryPoint(r: Row): HistoryPoint {
  const prov = r["provenance"];
  let provenance: HistoryPoint["provenance"] = "sourced";
  if (typeof prov === "string" && PROVENANCE.has(prov)) provenance = prov as HistoryPoint["provenance"];
  else if (prov !== undefined && prov !== null) markRepair();
  return {
    ...r,
    date: reqStr(r["date"]),
    completionRate: reqNum(r["completionRate"]),
    totalIssues: reqNum(r["totalIssues"]),
    completedIssues: reqNum(r["completedIssues"]),
    openBlockers: optNum(r["openBlockers"]),
    provenance,
  };
}

/** Financial fields on a project financials Row — the money figures the finance roll-ups read. Coerces
 *  the known numeric fields to finite (junk → null so a roll-up drops it, never sums it raw) and keeps
 *  every other field. */
const FINANCE_NUM_FIELDS = ["budgetAllocated", "actualBurn", "forecastCostAtCompletion", "earnedValue", "committed", "budget", "actualCost"] as const;
export function sanitizeFinancials(r: Row): Row {
  const out: Row = { ...r };
  for (const f of FINANCE_NUM_FIELDS) if (f in r) out[f] = optNum(r[f]);
  return out;
}

/** Resource-capacity Row — the hours/allocation figures the capacity roll-ups read. */
const CAPACITY_NUM_FIELDS = ["availableHours", "allocatedHours", "allocationPercentage", "assignedHours"] as const;
export function sanitizeCapacityRow(r: Row): Row {
  const out: Row = { ...r };
  for (const f of CAPACITY_NUM_FIELDS) if (f in r) out[f] = optNum(r[f]);
  return out;
}

/** Project: required id/name strings; optional status/omniInstanceId. Extra Row fields pass through. */
export function sanitizeProject(r: Row): Project {
  return { ...r, id: reqStr(r["id"]), name: reqStr(r["name"]) } as Project;
}

/** Issue: required identity/status strings; optional per-task money/effort/quality figures coerced to
 *  finite-or-null and booleans normalised. Extra Row fields pass through. */
const ISSUE_NUM_FIELDS = ["budget", "actualCost", "estimateHours", "loggedHours", "remainingHours", "storyPoints", "defectCount", "version"] as const;
const ISSUE_BOOL_FIELDS = ["billable", "blocked"] as const;
export function sanitizeIssue(r: Row): Issue {
  const out: Row = { ...r, id: reqStr(r["id"]), projectId: reqStr(r["projectId"]), title: reqStr(r["title"]), status: reqStr(r["status"]) };
  for (const f of ISSUE_NUM_FIELDS) if (f in r) out[f] = optNum(r[f]);
  for (const f of ISSUE_BOOL_FIELDS) if (f in r) out[f] = optBool(r[f]);
  return out as Issue;
}

// ── The wrapper — map each read method to its sanitizer (mirrors messy-broker's method set) ──────────
type RowSan = (r: Row) => object;
const ROWS_METHODS: Record<string, RowSan> = {
  listProjects: (r) => sanitizeProject(r),
  listIssues: (r) => sanitizeIssue(r),
  portfolioHealth: (r) => sanitizePortfolioRow(r),
  resourceCapacity: (r) => sanitizeCapacityRow(r),
  projectHistory: (r) => sanitizeHistoryPoint(r),
};
const ROW_METHODS: Record<string, RowSan> = {
  getIssue: (r) => sanitizeIssue(r),
  projectFinancials: (r) => sanitizeFinancials(r),
};

/** Wrap a broker so its entity READS are repaired to contract shape before anything above the seam sees
 *  them. Writes and non-listed reads pass through untouched. */
export function wrapWithSanitizer(base: Broker): Broker {
  return new Proxy(base, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function") return orig;
      const method = String(prop);
      const rowsSan = ROWS_METHODS[method];
      const rowSan = ROW_METHODS[method];
      if (!rowsSan && !rowSan) return (orig as (...a: unknown[]) => unknown).bind(target);
      return async function (this: unknown, ...args: unknown[]) {
        const result = await (orig as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        if (rowsSan && Array.isArray(result)) return result.map((row) => (row && typeof row === "object" ? rowsSan(row as Row) : row));
        if (rowSan && result && typeof result === "object") return rowSan(result as Row);
        return result;
      };
    },
  }) as Broker;
}
