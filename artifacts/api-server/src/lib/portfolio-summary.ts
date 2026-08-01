import type { Request } from "express";
import { consolidateByGroup, consolidationSpec, numLoose as num, round1 } from "@workspace/backend-catalogue";
import { getBroker, contextFromReq, type PortfolioRow, type Row, type Project } from "../broker";
import { classifyRag } from "../broker/vocabulary";
import { envInt } from "./env-config";
import { getSettings } from "./settings";
import { getFxRates } from "./currency";
import { resolveCapabilities } from "./capabilities";
import { createConcurrencyLimiter, poolMapWith, poolSettleWith, settledValues, type Limiter } from "./concurrency-pool";
import { recordAttempted, recordUnavailable, availabilityReport } from "./read-availability";
import { summariseTasks, type TaskSummary } from "./task-summary";
import { planProjectSources, type SourcePlan } from "./closed-projects";
import { getReadCache } from "./read-cache";
import { actorKey } from "../broker/cache";

/**
 * Portfolio-wide AGGREGATE summary — the one shape allowed to cross an instance boundary for
 * federation (backlog #135, see docs/DATA-RESIDENCY.md). Every field here is a portfolio-level total
 * or count; nothing here ever carries a project id/name, a programme id/name, or a person's name —
 * only the SAME aggregate rollups the portfolio reports already compute (portfolio-finance.ts's
 * `FinanceRollup`, capacity-rollup.ts's `CapacityRollup`, and the portfolio-health RAG rollup),
 * reduced to their portfolio-total row. Computed live from the broker on every request — nothing is
 * cached or stored beyond the peer config itself (see lib/settings.ts PeerInstance).
 */

// Bound the per-project broker fan-out (financials + capacity) the same way the other portfolio
// reads do — an unbounded Promise.all is ~1 broker call per project, so 200 projects = a 200-way
// thundering herd per request against the backend.
// Tunable because the right value is a property of YOUR backend, not of OmniProject: 10 is safe against
// a rate-limited SaaS, but an on-prem OpenProject or a queue-mode n8n with scaled workers will take far
// more, and this is the only dial on the FALLBACK path (a broker implementing the bulk reads above skips
// the fan-out entirely). Raising it shortens a portfolio view linearly and costs backend 429s if set
// past what the backend tolerates — measure before raising it.
const PORTFOLIO_FANOUT_LIMIT = envInt("PORTFOLIO_FANOUT_LIMIT", 10, { min: 1, max: 200 });

/**
 * Ceiling on the per-project FALLBACK fan-out. Past this many projects the fan-out is refused outright
 * rather than attempted.
 *
 * Measured: the fan-out is one broker call per project at PORTFOLIO_FANOUT_LIMIT concurrency, so cost
 * is linear in project count — 3,000 projects against a 50ms backend hop takes 15s, 30,000 takes ~150s.
 * A request that takes two minutes is not a slow success, it is a failure that also pins a connection,
 * holds a worker, and lands 30,000 calls on a backend. Refusing is strictly better: the caller gets an
 * immediate, honest "totals unavailable, and here is why" through the same availability channel as a
 * dead backend, and the rows still render.
 *
 * The fix is not a bigger ceiling: it is the broker implementing `portfolioFinancials`/`portfolioCapacity`,
 * which skips the fan-out entirely and has no ceiling because it is one call.
 */
const PORTFOLIO_FANOUT_MAX_PROJECTS = envInt("PORTFOLIO_FANOUT_MAX_PROJECTS", 500, { min: 1, max: 100_000 });

/** Would fanning out over `projects` exceed the ceiling? Exported for the test that pins the arithmetic. */
export function fanoutWouldExceedCeiling(projectCount: number): boolean {
  return projectCount > PORTFOLIO_FANOUT_MAX_PROJECTS;
}

/** RAG (red/amber/green) distribution across the portfolio's projects. */
export interface RagCounts {
  green: number;
  amber: number;
  red: number;
  /** A ragStatus value the broker reported that isn't one of green/amber/red. */
  other: number;
}

export interface HealthTotals {
  projects: number;
  rag: RagCounts;
  avgScheduleVarianceDays: number | null;
  avgBudgetVariancePercentage: number | null;
  totalActiveBlockers: number;
}

/** Mirrors `FinanceRollup`'s portfolio-total fields (artifacts/omniproject/src/lib/portfolio-finance.ts)
 *  — programme/project breakdown is deliberately dropped; only the portfolio total ever crosses a
 *  federation boundary. */
export interface FinanceTotals {
  /** The reporting currency every amount below is converted into. */
  currency: string;
  budget: number;
  actual: number;
  forecast: number;
  earnedValue: number;
  variance: number;
  cpi: number | null;
}

/** Mirrors `CapacityRollup`'s portfolio-total fields (artifacts/omniproject/src/lib/capacity-rollup.ts). */
export interface CapacityTotals {
  allocations: number;
  overAllocated: number;
  assignedHours: number;
  availableHours: number;
  utilisation: number | null;
}

export interface PortfolioSummary {
  /** Live projects that ANSWERED. Read with `availability`: when a source is unavailable this is the
   *  count we could see, not the portfolio's true size, and `availability.complete` is false. */
  projects: number;
  /** Which sources answered while building this roll-up. `complete: false` means at least one backend
   *  did not answer, every cross-source total below is `null` by design (a total over a subset is wrong,
   *  not smaller), and the UI should say "N of M sources reporting" rather than present this as the
   *  portfolio. Nothing here is cached or persisted — it describes this request only. */
  availability: ReturnType<typeof availabilityReport>;
  /** Present ONLY when this roll-up was served from the opt-in read cache (`READ_CACHE_TTL_MS`), giving
   *  its age in ms. Absent means live — computed for this request, or the cache is off (the default).
   *  A stale total is not a wrong total, but it is not a live one either, and the UI should say so. */
  staleMs?: number;
  /** null when the connected backend doesn't declare the `portfolio` capability. */
  health: HealthTotals | null;
  /** null when the connected backend doesn't declare the `financials` capability (or has no data). */
  finance: FinanceTotals | null;
  /** null when the connected backend doesn't declare the `resources` capability (or has no data). */
  capacity: CapacityTotals | null;
  /** GTD task roll-up (open/actionable/overdue/…), or null when the backend models no tasks. */
  tasks: TaskSummary | null;
  /** Where this portfolio's projects live — live in the backend, closed-in-SOR, or migrated to the
   *  self-managed archive (resolved via planProjectSources from the closed-project registry + relinks).
   *  So a roll-up ACCOUNTS for closed/archived projects by GUID rather than silently dropping them. */
  sources: SourcePlan;
}

/** The result of folding per-project financials: the portfolio-total wire row plus how the fold was
 *  composed, so the caller can tell a complete total from a partial one. */
export interface FinanceFold {
  totals: FinanceTotals;
  /** Rows summed into the total (their currency converted to the target). */
  includedRows: number;
  /** Rows EXCLUDED because their currency had no FX rate to the target — omitted, never summed raw.
   *  A non-zero value means the total is currency-consistent but covers only a subset of projects. */
  droppedForFx: number;
}

/** Summarise portfolio-health rows (the existing `GET /portfolio/health` aggregate) into portfolio-wide
 *  counts — no per-project id/name survives. Pure; unit-testable without a broker. */
export function summarizeHealth(rows: PortfolioRow[]): HealthTotals {
  const rag: RagCounts = { green: 0, amber: 0, red: 0, other: 0 };
  let schedSum = 0, schedN = 0, budgetSum = 0, budgetN = 0, blockers = 0;
  for (const r of rows) {
    const c = classifyRag(r.ragStatus);
    if (c === "GREEN") rag.green++;
    else if (c === "AMBER") rag.amber++;
    else if (c === "RED") rag.red++;
    else rag.other++;

    const sv = r.scheduleVarianceDays;
    if (typeof sv === "number" && Number.isFinite(sv)) { schedSum += sv; schedN++; }
    const bv = r.budgetVariancePercentage;
    if (typeof bv === "number" && Number.isFinite(bv)) { budgetSum += bv; budgetN++; }
    blockers += num(r.activeBlockersCount);
  }
  return {
    projects: rows.length,
    rag,
    avgScheduleVarianceDays: schedN ? round1(schedSum / schedN) : null,
    avgBudgetVariancePercentage: budgetN ? round1(budgetSum / budgetN) : null,
    totalActiveBlockers: blockers,
  };
}

/** Fold per-project financials (the existing `GET /projects/:id/financials` rows) into ONE portfolio
 *  total in `target` currency — the portfolio-only reduction of `consolidateFinancials`. Pure.
 *  A row whose currency can't be converted to the target is EXCLUDED (counted in `droppedForFx`),
 *  never summed as-is — mixing currencies would silently produce a wildly wrong total. */
export function foldFinance(rows: Row[], target: string, rates?: Record<string, number>): FinanceFold {
  // The org-scope reduction of the `financials` consolidation: every row in ONE group. The engine's
  // measures/derived/FX-exclusion ARE this fold — an absent currency defaults to the target so it always
  // converts, matching the previous behaviour. `excludedForFx` is the dropped-for-FX count.
  const inputs = rows.map((p) => ({
    groupKey: "__portfolio__",
    groupLabel: "Portfolio",
    currency: String(p["currency"] ?? target),
    items: [p],
  }));
  const { total } = consolidateByGroup(inputs, consolidationSpec("financials"), target, rates);
  const m = total.metrics;
  return {
    totals: {
      currency: target,
      budget: (m["budget"] as number) ?? 0,
      actual: (m["actual"] as number) ?? 0,
      forecast: (m["forecast"] as number) ?? 0,
      earnedValue: (m["earnedValue"] as number) ?? 0,
      variance: (m["variance"] as number) ?? 0,
      cpi: (m["cpi"] as number | null) ?? null,
    },
    includedRows: total.projects - total.excludedForFx,
    droppedForFx: total.excludedForFx,
  };
}

/** Fold every project's resource rows (the existing `GET /projects/:id/capacity` rows, flattened
 *  across the portfolio) into ONE portfolio total — the portfolio-only reduction of `rollupByProgramme`. */
export function foldCapacity(rows: Row[]): CapacityTotals {
  // The org-scope reduction of the `capacity` consolidation: every resource row in ONE group, with a
  // nominal single currency so the engine's FX pass is inert (capacity has no money dimension).
  const inputs = rows.map((r) => ({ groupKey: "__portfolio__", groupLabel: "Portfolio", currency: "•", items: [r] }));
  const { total } = consolidateByGroup(inputs, consolidationSpec("capacity"), "•");
  const m = total.metrics;
  return {
    allocations: (m["allocations"] as number) ?? 0,
    overAllocated: (m["overAllocated"] as number) ?? 0,
    assignedHours: (m["assignedHours"] as number) ?? 0,
    availableHours: (m["availableHours"] as number) ?? 0,
    utilisation: (m["utilisation"] as number | null) ?? null,
  };
}

/** The org's FX "as of" date, mirroring the SPA's `resolveFxAsOf` (lib/currency.ts) — undefined for
 *  the default "spot" policy, else the configured as-of date (falls back to spot if unset). */
function resolveFxAsOf(settings: ReturnType<typeof getSettings>): string | undefined {
  if (settings.fxRatePolicy === "spot") return undefined;
  return settings.fxRateAsOfDate ?? undefined;
}

/**
 * Compute THIS instance's own portfolio summary — the local half of a federated view, and the exact
 * payload `GET /portfolio/summary` serves to a peer instance. Reuses the SAME broker calls the existing
 * per-project analytics routes already make (`listProjects`, `portfolioHealth`, `projectFinancials`,
 * `resourceCapacity`) — no new broker action, and the per-project detail those calls return is folded
 * away before it ever leaves this function. Best-effort per section: a capability the connected backend
 * doesn't declare (or a call that fails) yields `null` for that section rather than failing the whole
 * summary — the same graceful-degradation stance as an FX-rate fallback or a broker health probe.
 */
// The section-builder helpers below each do ONE job (build one section of the summary from the
// already-fetched projects/caps). They are mutually independent, so the caller runs them
// concurrently. `run` is a SHARED bounded limiter: passing the same limiter to the finance and
// capacity fan-outs caps their COMBINED per-project broker concurrency at PORTFOLIO_FANOUT_LIMIT, so
// overlapping the two sections doesn't double the herd on the backend — they interleave in one pool.
type Broker = ReturnType<typeof getBroker>;
type Ctx = ReturnType<typeof contextFromReq>;
type Caps = Awaited<ReturnType<typeof resolveCapabilities>> | null;

async function summaryHealth(broker: Broker, ctx: Ctx, caps: Caps): Promise<HealthTotals | null> {
  if (caps && !caps.portfolio) return null;
  const rows = await broker.portfolioHealth(ctx).catch(() => null);
  return rows ? summarizeHealth(rows) : null;
}

/**
 * Line a bulk read's rows up with the project list, positionally, so the bulk and fan-out paths hand
 * `summaryFinance`/`summaryCapacity` the same shape and every downstream count (`droppedCalls`) keeps
 * meaning what it meant. A project the bulk read didn't return is `null` — the same signal the
 * per-project path uses for a failed call — so a backend that silently omits projects is treated as
 * an incomplete read rather than a smaller portfolio.
 */
export function alignToProjects(rows: Row[], projects: Project[]): Array<Row | null> {
  const byId = new Map<string, Row>();
  for (const r of rows) {
    const id = String(r["projectId"] ?? r["id"] ?? "");
    if (id && !byId.has(id)) byId.set(id, r);
  }
  return projects.map((p) => byId.get(p.id) ?? null);
}

async function summaryFinance(req: Request, broker: Broker, ctx: Ctx, caps: Caps, projects: Project[], run: Limiter): Promise<FinanceTotals | null> {
  if ((caps && !caps.financials) || !projects.length) return null;
  const settings = getSettings();
  // ONE call when the broker can aggregate, N calls when it can't. The bulk path is O(1) round trips;
  // the fan-out below is O(projects) and is what makes a 30k-project portfolio take minutes. A bulk
  // failure is NOT silently retried per-project: that would turn one failed call into 30,000 and
  // hammer a backend that just told us it was struggling — it degrades to "unavailable" instead.
  const [rows, fx] = await Promise.all([
    broker.portfolioFinancials
      ? broker.portfolioFinancials(ctx).then(
          (all) => alignToProjects(all, projects),
          () => projects.map(() => null),
        )
      : fanoutWouldExceedCeiling(projects.length)
        ? Promise.resolve(projects.map(() => null)) // refused, not attempted — see the ceiling's comment
        : poolMapWith(run, projects, (p) => broker.projectFinancials(ctx, p.id).catch(() => null)),
    getFxRates(req, resolveFxAsOf(settings)).catch(() => null),
  ]);
  const valid = rows.filter((r): r is Row => !!r);
  const droppedCalls = projects.length - valid.length; // projects whose financials call failed/timed out
  // Each project whose financials call failed is a source that did not answer. Recorded (deduplicated)
  // so the response can say which, and so `readsWereComplete()` below can veto the total.
  recordAttempted(projects.length);
  if (!broker.portfolioFinancials && fanoutWouldExceedCeiling(projects.length)) {
    // ONE honest reason, not 30,000 identical ones — and it names the fix rather than blaming the backend.
    recordUnavailable("finance", `too many projects for a per-project fan-out (${projects.length}); backend needs a bulk portfolioFinancials read`);
    req.log.warn({ projects: projects.length, ceiling: PORTFOLIO_FANOUT_MAX_PROJECTS }, "portfolio finance fan-out refused — over the ceiling");
  } else {
    for (const [i, r] of rows.entries()) {
      if (r === null) recordUnavailable(`project:${projects[i]!.id}`, "financials read failed");
    }
  }
  if (!valid.length) {
    if (droppedCalls > 0) req.log.warn({ projects: projects.length, droppedCalls }, "portfolio finance rollup unavailable — every project's financials call failed");
    return null;
  }
  const target = settings.reportingCurrency || fx?.base || "GBP";
  const fold = foldFinance(valid, target, fx?.rates);
  // Never silent: if the total covers fewer projects than exist (a failed call or an unconvertible
  // currency), log it so an operator sees the rollup is partial, not a complete number.
  if (droppedCalls > 0 || fold.droppedForFx > 0) {
    req.log.warn(
      { projects: projects.length, withFinancials: valid.length, folded: fold.includedRows, droppedForFx: fold.droppedForFx, droppedCalls, target },
      "portfolio finance rollup is incomplete — total covers a subset of projects",
    );
  }
  // A total summed across sources is only reportable when every source answered. Over a subset it is
  // not a smaller total, it is a WRONG one — and screenshotted into a board pack it reads as
  // authoritative. Suppress it and let `availability` explain the gap; the per-project rows the caller
  // already holds are still real. (Warning above stays: operators see the gap in logs either way.)
  if (droppedCalls > 0 || fold.droppedForFx > 0) return null;
  // Only surface a total when at least one project actually folded in — an all-dropped fold would
  // otherwise report a misleading £0.
  return fold.includedRows > 0 ? fold.totals : null;
}

async function summaryCapacity(broker: Broker, ctx: Ctx, caps: Caps, projects: Project[], run: Limiter): Promise<CapacityTotals | null> {
  if ((caps && !caps.resources) || !projects.length) return null;
  // Settle rather than catch-to-empty: a failed project used to contribute `[]`, which is
  // indistinguishable from "this project has no resources", so the capacity total silently covered a
  // subset while looking complete. Now a failure is recorded as an unavailable source and vetoes the
  // total, exactly like finance above.
  recordAttempted(projects.length);
  // Bulk when the broker can, fan-out when it can't — same O(1)-vs-O(projects) trade as finance above.
  if (broker.portfolioCapacity) {
    const all = await broker.portfolioCapacity(ctx).catch(() => null);
    if (!all) {
      recordUnavailable("capacity", "bulk resource-capacity read failed");
      return null;
    }
    // SCOPE: the bulk reads take no projectId, so they are NOT covered by the seam's scope guard
    // (`PROJECT_ID_AT_ARG1` in broker/scope-guard.ts), which re-checks per-project calls. Filter to the
    // caller's VISIBLE projects here, or a programme-scoped user's capacity total would silently
    // include every other programme's rows. The per-project path got this for free by only ever asking
    // for projects it could see; the bulk path has to do it explicitly.
    const visible = new Set(projects.map((p) => p.id));
    const inScope = all.filter((r) => visible.has(String(r["projectId"] ?? r["id"] ?? "")));
    return inScope.length ? foldCapacity(inScope) : null;
  }
  if (fanoutWouldExceedCeiling(projects.length)) {
    recordUnavailable("capacity", `too many projects for a per-project fan-out (${projects.length}); backend needs a bulk portfolioCapacity read`);
    return null;
  }
  const settled = await poolSettleWith(run, projects, (p) => broker.resourceCapacity(ctx, p.id));
  for (const s of settled) {
    if (!s.ok) recordUnavailable(`project:${s.item.id}`, "resource-capacity read failed");
  }
  if (settled.some((s) => !s.ok)) return null;
  const all = settledValues(settled).flat();
  return all.length ? foldCapacity(all) : null;
}

/** The read-cache key for a portfolio summary — the caller's identity+data-scope (`actorKey`, the scope-safe
 *  fingerprint the broker cache uses) plus the reporting-currency posture. Exported + pure so the
 *  no-cross-scope-collision property is unit-testable: two callers differing only in data scope MUST get
 *  different keys, or an all-scope admin's rollup could be served to a programme-scoped token. */
export function portfolioSummaryCacheKey(ctx: Ctx, settings: ReturnType<typeof getSettings>): string {
  return `portfolio-summary:${actorKey(ctx)}:cur=${settings.reportingCurrency || ""}:fx=${resolveFxAsOf(settings) ?? "spot"}`;
}

async function summaryTasks(broker: Broker, ctx: Ctx): Promise<TaskSummary | null> {
  // Only when the active backend actually models tasks (an optional broker capability).
  if (!broker.listTasks) return null;
  const rows = await broker.listTasks(ctx, {}).catch(() => null);
  return rows ? summariseTasks(rows) : null;
}

/** Build the portfolio rollup for this request by fanning the four sections (health, finance,
 *  capacity, tasks) out in parallel over the broker, then folding them into one summary. Byte-for-byte
 *  the same output as the sequential form — only faster (see the per-section helpers above). */
export async function computeLocalPortfolioSummary(req: Request): Promise<PortfolioSummary> {
  const broker = getBroker();
  const ctx = contextFromReq(req);
  // SCALING.md §3: org-wide this fans one broker call per project (up to N round-trips). When the shared
  // read cache is opted in (`READ_CACHE_TTL_MS`), memoise the whole computed summary for the TTL — keyed by
  // the caller's IDENTITY+DATA SCOPE (`actorKey`, the same scope-safe key the broker cache uses, so an
  // all-scope admin's rollup is never served to a programme-scoped token) and the reporting-currency posture
  // (so a currency switch can't serve a wrong-currency total). Off by default ⇒ a pass-through (recomputes).
  const key = portfolioSummaryCacheKey(ctx, getSettings());
  // Report staleness rather than hiding it: a cached roll-up looks identical to a live one, and the
  // whole product promise is that what you see is the backend right now. `staleMs` is null when the
  // cache is off (the default) or the value was just computed.
  const { value, staleMs } = await getReadCache().wrapWithFreshness(key, () => computeFreshPortfolioSummary(req, broker, ctx));
  return staleMs === null ? value : { ...value, staleMs };
}

/** The uncached fold: fan the four sections out over the broker and reduce them. Split from the cached entry
 *  point above so the fan-out logic has one home whether or not the read cache is enabled. */
async function computeFreshPortfolioSummary(req: Request, broker: Broker, ctx: Ctx): Promise<PortfolioSummary> {
  // Capabilities and the project list are independent — fetch them concurrently.
  // `listProjects` failing used to degrade to `[]`, so a total outage reported `projects: 0` — an empty
  // portfolio, indistinguishable from a healthy org that has none. Record it as an unavailable source
  // so `availability.complete` is false and the UI says "unavailable" instead of "zero".
  const [caps, projects] = await Promise.all([
    resolveCapabilities(req).catch(() => null),
    broker.listProjects(ctx).catch(() => {
      recordAttempted(1);
      recordUnavailable("projects", "project list read failed");
      return [] as Project[];
    }),
  ]);

  // The four sections share no data (all derive from projects/caps), so run them concurrently.
  // One shared limiter holds the combined finance+capacity fan-out to PORTFOLIO_FANOUT_LIMIT.
  const run = createConcurrencyLimiter(PORTFOLIO_FANOUT_LIMIT);
  const [health, finance, capacity, tasks] = await Promise.all([
    summaryHealth(broker, ctx, caps),
    summaryFinance(req, broker, ctx, caps, projects, run),
    summaryCapacity(broker, ctx, caps, projects, run),
    summaryTasks(broker, ctx),
  ]);

  // Source plan — the live projects' GUIDs ∪ every closed-project GUID, bucketed live/sor/archive
  // (relinks followed). Threads the closed-project registry through the roll-up so archived/closed
  // sources are accounted for, not dropped; the actual archived-data fetch is a follow-up.
  const settings = getSettings();
  const liveGuids = (projects as Row[]).map((p) => String(p["omniInstanceId"] ?? "")).filter(Boolean);
  const sources = planProjectSources([...liveGuids, ...Object.keys(settings.closedProjects)], settings.closedProjects, settings.guidAliases);

  return { projects: projects.length, availability: availabilityReport(), health, finance, capacity, tasks, sources };
}
