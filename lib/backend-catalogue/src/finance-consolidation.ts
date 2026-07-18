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

/** Coerce a possibly-dirty numeric field to a finite number (string/null/NaN/±Infinity → 0). */
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Round to 2 decimal places (money). */
const round2 = (n: number): number => Math.round(n * 100) / 100;

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

/** A roll-up row mid-fold: carries the tracker of source currencies seen so far. */
interface WorkingRollup extends FinanceRollup {
  _tracker: LocalTracker;
}

function blank(key: string, label: string): WorkingRollup {
  return { key, label, projects: 0, budget: 0, actual: 0, forecast: 0, earnedValue: 0, variance: 0, cpi: null, localCurrency: null, local: null, excludedForFx: 0, _tracker: new LocalTracker() };
}

/** Fold one project's financials (converted to the reporting currency) into a roll-up row, tracking
 *  the row's un-converted `local` totals too — for as long as every project folded shares one currency. */
function fold(acc: WorkingRollup, p: ProjectFin, target: string, rates?: Record<string, number>): void {
  const currency = String(p.fin.currency ?? "");
  // Amounts come from the untrusted read model — coerce BEFORE converting/summing so a
  // string/null/NaN budget can't propagate a NaN through the whole consolidated total.
  const raw = {
    budget: num(p.fin.budgetAllocated),
    actual: num(p.fin.actualBurn),
    forecast: num(p.fin.forecastCostAtCompletion),
    earnedValue: num(p.fin.earnedValue),
  };
  const conv = (n: number) => convertAmount(n, currency, target, rates);
  acc.projects += 1;
  // Only fold into the consolidated (target-currency) total when the row can actually be converted;
  // convertAmount passes the amount through UNCHANGED when a rate is missing, so summing an
  // unconvertible row would add a raw foreign amount to the total.
  if (isConvertible(currency, target, rates)) {
    acc.budget += conv(raw.budget);
    acc.actual += conv(raw.actual);
    acc.forecast += conv(raw.forecast);
    acc.earnedValue += conv(raw.earnedValue);
  } else {
    acc.excludedForFx += 1;
  }

  if (acc._tracker.add(currency)) {
    const local = acc.local ?? { budget: 0, actual: 0, forecast: 0, earnedValue: 0 };
    local.budget += raw.budget;
    local.actual += raw.actual;
    local.forecast += raw.forecast;
    local.earnedValue += raw.earnedValue;
    acc.local = local;
  } else {
    // A second distinct currency showed up — the row is mixed, a single local figure no longer applies.
    acc.local = null;
  }
  acc.localCurrency = acc._tracker.currency;
}

/** Finalise the derived fields (variance + consolidated CPI) and round the money, in both the
 *  consolidated and (when present) local currency. */
function finalise(r: WorkingRollup): FinanceRollup {
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    budget: round2(r.budget),
    actual: round2(r.actual),
    forecast: round2(r.forecast),
    earnedValue: round2(r.earnedValue),
    variance: round2(r.budget - r.forecast),
    cpi: r.actual > 0 ? Math.round((r.earnedValue / r.actual) * 100) / 100 : null,
    localCurrency: r.localCurrency,
    local: r.local
      ? { budget: round2(r.local.budget), actual: round2(r.local.actual), forecast: round2(r.local.forecast), earnedValue: round2(r.local.earnedValue) }
      : null,
    excludedForFx: r.excludedForFx,
  };
}

/**
 * Consolidate projects into programme roll-ups + a portfolio total, all in `reportingCurrency`. Standalone
 * projects share a "Standalone" group; programmes are returned worst-variance first so overspend surfaces.
 */
export function consolidateFinancials(
  projects: ProjectFin[],
  reportingCurrency: string,
  rates?: Record<string, number>,
): { programmes: FinanceRollup[]; portfolio: FinanceRollup; currencyMix: CurrencyMix[] } {
  const groups = new Map<string, WorkingRollup>();
  const portfolio = blank("__portfolio__", "Portfolio");
  const mix = new Map<string, number>();
  for (const p of projects) {
    const key = p.programmeId ?? "__standalone__";
    const label = p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone";
    const row = groups.get(key) ?? blank(key, label);
    fold(row, p, reportingCurrency, rates);
    groups.set(key, row);
    fold(portfolio, p, reportingCurrency, rates);
    mix.set(p.fin.currency, (mix.get(p.fin.currency) ?? 0) + 1);
  }
  // key (the programmeId) is unique per group ⇒ deterministic order for equal variance.
  const programmes = [...groups.values()].map(finalise).sort((a, b) => a.variance - b.variance || a.key.localeCompare(b.key));
  const currencyMix = [...mix.entries()].map(([currency, n]) => ({ currency, projects: n })).sort((a, b) => b.projects - a.projects);
  return { programmes, portfolio: finalise(portfolio), currencyMix };
}
