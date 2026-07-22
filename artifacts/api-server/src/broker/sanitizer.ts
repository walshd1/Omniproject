import { AsyncLocalStorage } from "node:async_hooks";
import { consolidationFields } from "@workspace/backend-catalogue";
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
// Derived from the consolidation specs (the single source of truth for which fields a roll-up reads):
// the financials + costs specs, plus `committed` — a raw figure the programme-level aggregateFinancials
// reads that is NOT a consolidation measure. Adding a measure field to a spec now auto-extends the
// sanitiser, so the two can't drift.
const FINANCE_NUM_FIELDS = [...new Set([...consolidationFields(["financials", "costs"]), "committed"])];
export function sanitizeFinancials(r: Row): Row {
  const out: Row = { ...r };
  for (const f of FINANCE_NUM_FIELDS) if (f in r) out[f] = optNum(r[f]);
  return out;
}

/** Resource-capacity Row — the hours/allocation figures the capacity roll-ups read. Derived from the
 *  capacity consolidation spec plus the alternate `allocatedHours` figure some backends report. */
const CAPACITY_NUM_FIELDS = [...new Set([...consolidationFields(["capacity"]), "allocatedHours"])];
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

/** An enum-ish field: keep it only if it's one of `allowed`, else repair to `fallback` (a present-but-
 *  unknown value counts as a repair; an absent one takes the fallback silently). */
function enumField<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) return raw as T;
  if (raw !== undefined && raw !== null) markRepair();
  return fallback;
}

/** ProjectMember: id required; the capacity hours are the numeric fields the resource roll-ups read. */
export function sanitizeMember(r: Row): Row {
  const out: Row = { ...r, id: reqStr(r["id"]), access: enumField(r["access"], ["read", "write"] as const, "read") };
  if ("availableHours" in r) out["availableHours"] = optNum(r["availableHours"]);
  if ("allocatedHours" in r) out["allocatedHours"] = optNum(r["allocatedHours"]);
  return out;
}

/** Task: identity/title/status required strings; estimateHours/sortOrder coerced. Rest passes through. */
export function sanitizeTask(r: Row): Row {
  const out: Row = { ...r, id: reqStr(r["id"]), title: reqStr(r["title"]), status: reqStr(r["status"]) };
  if ("estimateHours" in r) out["estimateHours"] = optNum(r["estimateHours"]);
  if ("sortOrder" in r) out["sortOrder"] = optNum(r["sortOrder"]);
  return out;
}

/** TaskItem / TaskComment / TaskAttachment: string-identity records; attachment size is numeric. */
export function sanitizeTaskItem(r: Row): Row {
  return { ...r, id: reqStr(r["id"]), taskId: reqStr(r["taskId"]), content: reqStr(r["content"]), createdAt: reqStr(r["createdAt"]), kind: enumField(r["kind"], ["issue", "note"] as const, "note") };
}
export function sanitizeTaskComment(r: Row): Row {
  return { ...r, id: reqStr(r["id"]), taskId: reqStr(r["taskId"]), body: reqStr(r["body"]), createdAt: reqStr(r["createdAt"]) };
}
/** Coerce a task attachment row to its typed shape (ids/filename/addedAt required; size optional). */
export function sanitizeTaskAttachment(r: Row): Row {
  const out: Row = { ...r, id: reqStr(r["id"]), taskId: reqStr(r["taskId"]), filename: reqStr(r["filename"]), addedAt: reqStr(r["addedAt"]) };
  if ("size" in r) out["size"] = optNum(r["size"]);
  return out;
}

/** Summary: total + the byStatus/byPriority count maps must be finite numbers (a junk count would
 *  poison a downstream chart/total). */
function sanitizeCountMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") { if (v !== undefined && v !== null) markRepair(); return {}; }
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = reqNum(val);
  return out;
}
/** Coerce a project summary row: projectId + total are required numbers/strings, and the byStatus /
 *  byPriority count maps are each forced to finite numbers (a junk count would poison a chart/total). */
export function sanitizeSummary(r: Row): Row {
  return { ...r, projectId: reqStr(r["projectId"]), total: reqNum(r["total"]), byStatus: sanitizeCountMap(r["byStatus"]), byPriority: sanitizeCountMap(r["byPriority"]) };
}

/** Baseline: identity strings; the item list passes through (dates are validated where they're used). */
export function sanitizeBaseline(r: Row): Row {
  return { ...r, projectId: reqStr(r["projectId"]), capturedAt: reqStr(r["capturedAt"]) };
}

/** FX rates — MONEY-CRITICAL: a junk/non-positive rate would corrupt every currency conversion. Keep
 *  only finite POSITIVE rates (a rate ≤ 0 or non-finite is dropped, so the currency becomes
 *  unconvertible rather than producing a garbage figure), and default an unknown provenance. */
export function sanitizeFxRates(r: Row): Row {
  const rawRates = r["rates"];
  const rates: Record<string, number> = {};
  if (rawRates && typeof rawRates === "object") {
    for (const [ccy, rate] of Object.entries(rawRates as Record<string, unknown>)) {
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[ccy] = rate;
      else markRepair();
    }
  } else if (rawRates !== undefined && rawRates !== null) markRepair();
  return { ...r, base: reqStr(r["base"]), rates, provenance: enumField(r["provenance"], ["sourced", "sample"] as const, "sourced") };
}

/** Generic hygiene for the untyped Row streams (activity / RAID / notifications) that have no numeric
 *  schema: strip prototype-pollution keys so a hostile/dirty row can't poison an object it's merged
 *  into downstream. Everything else passes through unchanged. */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export function sanitizeGenericRow(r: Row): Row {
  const out: Row = {};
  let stripped = false;
  for (const k of Object.keys(r)) {
    if (DANGEROUS_KEYS.has(k)) { stripped = true; continue; }
    out[k] = r[k];
  }
  if (stripped) markRepair();
  return out;
}

// ── The wrapper — map EVERY data-returning read + write method to its sanitizer ──────────────────────
type RowSan = (r: Row) => object;
/** Methods returning an ARRAY of entities/rows — every element is sanitized. */
const ROWS_METHODS: Record<string, RowSan> = {
  listProjects: sanitizeProject,
  projectMembers: sanitizeMember,
  listIssues: sanitizeIssue,
  listTaskItems: sanitizeTaskItem,
  listTasks: sanitizeTask,
  listTaskComments: sanitizeTaskComment,
  listTaskAttachments: sanitizeTaskAttachment,
  listActivity: sanitizeGenericRow,
  projectHistory: sanitizeHistoryPoint,
  listRaid: sanitizeGenericRow,
  notifications: sanitizeGenericRow,
  portfolioHealth: sanitizePortfolioRow,
  resourceCapacity: sanitizeCapacityRow,
};
/** Methods returning a SINGLE entity/row (possibly null) — reads AND write-returns, so a backend that
 *  echoes back a malformed created/updated entity is repaired before it reaches the UI too. */
const ROW_METHODS: Record<string, RowSan> = {
  getIssue: sanitizeIssue,
  writeIssue: sanitizeIssue,
  createProject: sanitizeProject,
  updateProject: sanitizeProject,
  createTaskItem: sanitizeTaskItem,
  getTask: sanitizeTask,
  createTask: sanitizeTask,
  updateTask: sanitizeTask,
  addTaskComment: sanitizeTaskComment,
  addTaskAttachment: sanitizeTaskAttachment,
  addRaid: sanitizeGenericRow,
  projectSummary: sanitizeSummary,
  baseline: sanitizeBaseline,
  projectFinancials: sanitizeFinancials,
  fxRates: sanitizeFxRates,
};
// Intentionally NOT sanitized: pure control/meta outputs that are structured config, not backend data
// rows — capabilities, verify, fieldMap, describeFields, describeSchema, replay, changeToken,
// verifyConnection, storeCredential. They carry no free-form numeric read-model to corrupt a derivation.

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
