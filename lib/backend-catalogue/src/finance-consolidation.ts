/**
 * Portfolio financial consolidation — the ONE pure, dependency-free implementation shared by the SPA
 * (the Portfolio Financials report + Exec Board Pack) and the gateway (the `/api/portfolio/financials`
 * fan-out). Convert each project's budget / actual / forecast into ONE reporting currency via a
 * base-anchored FX table and roll them up by programme and across the portfolio. Derive-only: the caller
 * supplies each project's financials + the FX rates; nothing is stored.
 *
 * Previously this lived only in the SPA (`lib/portfolio-finance.ts`) with a hand-kept "twin" in the
 * gateway (`lib/portfolio-summary.ts` `foldFinance`) that the two had to keep in sync by comment. This is
 * that single source of truth. Kept free of any React / api-client dependency (structural input type) so
 * both packages import it.
 */
import { consolidateByGroup, consolidationSpec, type ConsolidatedRow, type ConsolidationInput } from "./consolidation";

/**
 * Convert between currencies via a base-anchored rate table. Falls back to the original amount if a rate
 * is missing (so a UI never shows NaN) — callers that SUM must gate on {@link isConvertible} first.
 */
export function convertAmount(amount: number, from: string, to: string, rates?: Record<string, number>): number {
  if (!rates || from === to) return amount;
  // Own-property + finite guards: a code like "__proto__" would otherwise read an inherited member.
  const rFrom = Object.hasOwn(rates, from) ? rates[from] : undefined;
  const rTo = Object.hasOwn(rates, to) ? rates[to] : undefined;
  if (!Number.isFinite(rFrom) || !Number.isFinite(rTo) || rTo === 0) return amount;
  return (amount * (rFrom as number)) / (rTo as number);
}

/** Whether `from` can actually be converted to `to` with these rates — callers that SUM across
 *  currencies must use this to exclude unconvertible rows, or a raw foreign amount corrupts the total. */
export function isConvertible(from: string, to: string, rates?: Record<string, number>): boolean {
  if (from === to) return true;
  if (!rates) return false;
  const rFrom = Object.hasOwn(rates, from) ? rates[from] : undefined;
  const rTo = Object.hasOwn(rates, to) ? rates[to] : undefined;
  return Number.isFinite(rFrom) && Number.isFinite(rTo) && rTo !== 0;
}

/** The sorted list of currency codes a rate table can convert between. */
export function currencyList(rates?: Record<string, number>): string[] {
  return rates ? Object.keys(rates).sort() : [];
}

/** The display currency assumed when nothing else resolves one. One place so every surface agrees. */
export const DEFAULT_CURRENCY = "GBP";

/**
 * Track whether every project folded into a roll-up row so far shares one source currency, so the row
 * can show a `local` (un-converted) figure alongside the consolidated total. Once a second currency
 * appears the row is "mixed" and only the consolidated total applies.
 */
export class LocalTracker {
  currency: string | null = null;
  private seen = new Set<string>();

  /** Fold one more project's currency in; returns true while the row is still single-currency. */
  add(currency: string): boolean {
    this.seen.add(currency);
    this.currency = this.seen.size === 1 ? currency : null;
    return this.seen.size === 1;
  }
}

/** The subset of a project's financials the consolidation reads — structural, so no api-client/zod dep. */
export interface ProjectFinancialsLike {
  currency: string;
  budgetAllocated?: unknown;
  actualBurn?: unknown;
  forecastCostAtCompletion?: unknown;
  earnedValue?: unknown;
}

/** One project's financials, tagged with its programme for grouping. */
export interface ProjectFin {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  fin: ProjectFinancialsLike;
}

/** A row's un-converted totals in its own `localCurrency` — same shape as the consolidated fields. */
export interface LocalTotals {
  budget: number;
  actual: number;
  forecast: number;
  earnedValue: number;
}

/** A consolidated financial row (a programme, or the whole portfolio), all amounts in the reporting currency. */
export interface FinanceRollup {
  key: string;
  label: string;
  projects: number;
  budget: number;
  actual: number;
  /** Forecast cost at completion (the EAC roll-up) — the forward-looking number. */
  forecast: number;
  earnedValue: number;
  /** budget − forecast: positive = projected underspend, negative = projected overspend. */
  variance: number;
  /** Consolidated cost performance index = earnedValue ÷ actual (null when no spend yet). */
  cpi: number | null;
  /** The single local currency shared by every project folded into this row, or null once the row
   *  mixes ≥2 currencies (a multi-country programme, or the portfolio — only the consolidated total
   *  applies then). A single-project row (most "Standalone" rows) is always set. */
  localCurrency: string | null;
  /** Un-converted totals in `localCurrency` — present only while the row is single-currency. */
  local: LocalTotals | null;
  /** Projects excluded from the consolidated total because their currency has no rate to the
   *  reporting currency (summing the raw foreign amount would corrupt the total). */
  excludedForFx: number;
}

/** Distinct source currencies seen across the projects (so the UI can say "consolidated from N currencies"). */
export interface CurrencyMix {
  currency: string;
  projects: number;
}

/** Re-label a generic consolidated row (from the `financials` spec) as a `FinanceRollup`. The spec's
 *  measure/derived keys (budget/actual/forecast/earnedValue/variance/cpi) map 1:1 onto the named fields. */
function toFinanceRollup(r: ConsolidatedRow): FinanceRollup {
  const m = r.metrics;
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    budget: (m["budget"] as number) ?? 0,
    actual: (m["actual"] as number) ?? 0,
    forecast: (m["forecast"] as number) ?? 0,
    earnedValue: (m["earnedValue"] as number) ?? 0,
    variance: (m["variance"] as number) ?? 0,
    cpi: (m["cpi"] as number | null) ?? null,
    localCurrency: r.localCurrency,
    local: r.local
      ? { budget: r.local["budget"] ?? 0, actual: r.local["actual"] ?? 0, forecast: r.local["forecast"] ?? 0, earnedValue: r.local["earnedValue"] ?? 0 }
      : null,
    excludedForFx: r.excludedForFx,
  };
}

/**
 * Consolidate projects into programme roll-ups + a portfolio total, all in `reportingCurrency`. Standalone
 * projects share a "Standalone" group; programmes are returned worst-variance first so overspend surfaces.
 *
 * This is now a thin caller of the generic `consolidateByGroup` engine driven by the `financials`
 * consolidation spec — the group → FX-convert → local-track → derive fold is no longer re-implemented here.
 * (`consolidation.ts` imports the FX primitives above; the spec lookup is lazy to keep that cycle init-safe.)
 * The currency mix is a plain tally the engine doesn't produce, so it stays.
 */
export function consolidateFinancials(
  projects: ProjectFin[],
  reportingCurrency: string,
  rates?: Record<string, number>,
): { programmes: FinanceRollup[]; portfolio: FinanceRollup; currencyMix: CurrencyMix[] } {
  const spec = consolidationSpec("financials");
  const inputs: ConsolidationInput[] = projects.map((p) => ({
    groupKey: p.programmeId ?? "__standalone__",
    groupLabel: p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone",
    currency: String(p.fin.currency ?? ""),
    items: [p.fin as unknown as Record<string, unknown>],
  }));
  const { groups, total } = consolidateByGroup(inputs, spec, reportingCurrency, rates);

  const mix = new Map<string, number>();
  for (const p of projects) mix.set(p.fin.currency, (mix.get(p.fin.currency) ?? 0) + 1);
  const currencyMix = [...mix.entries()].map(([currency, n]) => ({ currency, projects: n })).sort((a, b) => b.projects - a.projects);

  return { programmes: groups.map(toFinanceRollup), portfolio: toFinanceRollup(total), currencyMix };
}
