import type { Request } from "express";
import { getBroker, contextFromReq, type PortfolioRow, type Row, type Project } from "../broker";
import { getSettings } from "./settings";
import { getFxRates } from "./currency";
import { resolveCapabilities } from "./capabilities";
import { poolMap } from "./concurrency-pool";

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
}

/** Coerce a possibly-dirty number (string, null, NaN, Infinity) to a finite number, else 0. Same
 *  defensive coercion the frontend rollups apply — the read model is untrusted. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The multiplicative factor to convert `from`→`to` via a base-anchored rate table, or `null` when
 *  the conversion is impossible (a foreign currency with no rate). Returns 1 for a same-currency
 *  row (no rate table needed), so target-currency projects always fold correctly even when the FX
 *  fetch failed. A `null` here means "cannot faithfully convert" — the caller EXCLUDES the row
 *  rather than summing a raw foreign amount as if it were the target currency, which would silently
 *  corrupt the portfolio total (e.g. ₩1,000,000,000 added straight into a GBP rollup). */
function conversionFactor(from: string, to: string, rates: Record<string, number> | undefined): number | null {
  if (!from || from === to) return 1;
  if (!rates) return null;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) return null;
  return rFrom / rTo;
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
  let budget = 0, actual = 0, forecast = 0, earnedValue = 0;
  let includedRows = 0, droppedForFx = 0;
  for (const p of rows) {
    const currency = String(p["currency"] ?? target);
    const factor = conversionFactor(currency, target, rates);
    if (factor === null) { droppedForFx++; continue; }
    includedRows++;
    budget += num(p["budgetAllocated"]) * factor;
    actual += num(p["actualBurn"]) * factor;
    forecast += num(p["forecastCostAtCompletion"]) * factor;
    earnedValue += num(p["earnedValue"]) * factor;
  }
  return {
    totals: {
      currency: target,
      budget: round2(budget),
      actual: round2(actual),
      forecast: round2(forecast),
      earnedValue: round2(earnedValue),
      variance: round2(budget - forecast),
      cpi: actual > 0 ? round2(earnedValue / actual) : null,
    },
    includedRows,
    droppedForFx,
  };
}

/** Fold every project's resource rows (the existing `GET /projects/:id/capacity` rows, flattened
 *  across the portfolio) into ONE portfolio total — the portfolio-only reduction of `rollupByProgramme`. */
export function foldCapacity(rows: Row[]): CapacityTotals {
  let allocations = 0, overAllocated = 0, assignedHours = 0, availableHours = 0;
  for (const r of rows) {
    allocations += 1;
    if (num(r["allocationPercentage"]) > 100) overAllocated += 1;
    assignedHours += num(r["assignedHours"]);
    availableHours += num(r["availableHours"]);
  }
  return {
    allocations,
    overAllocated,
    assignedHours: round1(assignedHours),
    availableHours: round1(availableHours),
    utilisation: availableHours > 0 ? Math.round((assignedHours / availableHours) * 1000) / 10 : null,
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
export async function computeLocalPortfolioSummary(req: Request): Promise<PortfolioSummary> {
  const broker = getBroker();
  const ctx = contextFromReq(req);
  const caps = await resolveCapabilities(req).catch(() => null);
  const projects = await broker.listProjects(ctx).catch(() => [] as Project[]);

  let health: HealthTotals | null = null;
  if (!caps || caps.portfolio) {
    const rows = await broker.portfolioHealth(ctx).catch(() => null);
    if (rows) health = summarizeHealth(rows);
  }

  let finance: FinanceTotals | null = null;
  if ((!caps || caps.financials) && projects.length) {
    const rows = await poolMap(projects, PORTFOLIO_FANOUT_LIMIT, (p) => broker.projectFinancials(ctx, p.id).catch(() => null));
    const valid = rows.filter((r): r is Row => !!r);
    const droppedCalls = projects.length - valid.length; // projects whose financials call failed/timed out
    if (valid.length) {
      const settings = getSettings();
      const fx = await getFxRates(req, resolveFxAsOf(settings)).catch(() => null);
      const target = settings.reportingCurrency || fx?.base || "GBP";
      const fold = foldFinance(valid, target, fx?.rates);
      // Only surface a total when at least one project actually folded in — an all-dropped fold
      // (every project in a currency we can't convert) would otherwise report a misleading £0.
      finance = fold.includedRows > 0 ? fold.totals : null;
      // Never silent: if the total covers fewer projects than exist (a failed financials call or an
      // unconvertible currency), log it so an operator can see the rollup is partial rather than
      // trusting an understated number presented as complete.
      if (droppedCalls > 0 || fold.droppedForFx > 0) {
        req.log.warn(
          { projects: projects.length, withFinancials: valid.length, folded: fold.includedRows, droppedForFx: fold.droppedForFx, droppedCalls, target },
          "portfolio finance rollup is incomplete — total covers a subset of projects",
        );
      }
    } else if (droppedCalls > 0) {
      req.log.warn({ projects: projects.length, droppedCalls }, "portfolio finance rollup unavailable — every project's financials call failed");
    }
  }

  let capacity: CapacityTotals | null = null;
  if ((!caps || caps.resources) && projects.length) {
    const lists = await poolMap(projects, PORTFOLIO_FANOUT_LIMIT, (p) => broker.resourceCapacity(ctx, p.id).catch(() => [] as Row[]));
    const all = lists.flat();
    if (all.length) capacity = foldCapacity(all);
  }

  return { projects: projects.length, health, finance, capacity };
}
