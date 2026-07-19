import type { Request } from "express";
import { consolidateByGroup, consolidationSpec } from "@workspace/backend-catalogue";
import { getBroker, contextFromReq, type PortfolioRow, type Row, type Project } from "../broker";
import { getSettings } from "./settings";
import { getFxRates } from "./currency";
import { resolveCapabilities } from "./capabilities";
import { createConcurrencyLimiter } from "./concurrency-pool";
import { summariseTasks, type TaskSummary } from "./task-summary";
import { planProjectSources, type SourcePlan } from "./closed-projects";

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
const PORTFOLIO_FANOUT_LIMIT = 10;

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
  projects: number;
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

/** Coerce a possibly-dirty number (string, null, NaN, Infinity) to a finite number, else 0. Same
 *  defensive coercion the frontend rollups apply — the read model is untrusted. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

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
    const status = String(r.ragStatus ?? "").toLowerCase();
    if (status === "green") rag.green++;
    else if (status === "amber") rag.amber++;
    else if (status === "red") rag.red++;
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
type Limiter = ReturnType<typeof createConcurrencyLimiter>;

async function summaryHealth(broker: Broker, ctx: Ctx, caps: Caps): Promise<HealthTotals | null> {
  if (caps && !caps.portfolio) return null;
  const rows = await broker.portfolioHealth(ctx).catch(() => null);
  return rows ? summarizeHealth(rows) : null;
}

async function summaryFinance(req: Request, broker: Broker, ctx: Ctx, caps: Caps, projects: Project[], run: Limiter): Promise<FinanceTotals | null> {
  if ((caps && !caps.financials) || !projects.length) return null;
  const settings = getSettings();
  // FX is independent of the financials rows (needed only at fold time) — fetch it alongside the fan-out.
  const [rows, fx] = await Promise.all([
    Promise.all(projects.map((p) => run(() => broker.projectFinancials(ctx, p.id).catch(() => null)))),
    getFxRates(req, resolveFxAsOf(settings)).catch(() => null),
  ]);
  const valid = rows.filter((r): r is Row => !!r);
  const droppedCalls = projects.length - valid.length; // projects whose financials call failed/timed out
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
  // Only surface a total when at least one project actually folded in — an all-dropped fold would
  // otherwise report a misleading £0.
  return fold.includedRows > 0 ? fold.totals : null;
}

async function summaryCapacity(broker: Broker, ctx: Ctx, caps: Caps, projects: Project[], run: Limiter): Promise<CapacityTotals | null> {
  if ((caps && !caps.resources) || !projects.length) return null;
  const lists = await Promise.all(projects.map((p) => run(() => broker.resourceCapacity(ctx, p.id).catch(() => [] as Row[]))));
  const all = lists.flat();
  return all.length ? foldCapacity(all) : null;
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
  // Capabilities and the project list are independent — fetch them concurrently.
  const [caps, projects] = await Promise.all([
    resolveCapabilities(req).catch(() => null),
    broker.listProjects(ctx).catch(() => [] as Project[]),
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

  return { projects: projects.length, health, finance, capacity, tasks, sources };
}
