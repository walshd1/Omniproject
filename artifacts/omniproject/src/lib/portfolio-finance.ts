import type { ProjectFinancials } from "@workspace/api-client-react";
import { convertAmount } from "./currency";

/**
 * Portfolio financial consolidation — convert each project's budget / actual / forecast into ONE
 * reporting currency and roll them up by programme and across the portfolio. This is the number a head
 * of projects can't assemble without a spreadsheet at multi-country scale. Pure and derive-only: the
 * caller supplies each project's financials + the FX table; nothing is stored.
 */

/** One project's financials, tagged with its programme for grouping. */
export interface ProjectFin {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  fin: ProjectFinancials;
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
}

/** Distinct source currencies seen across the projects (so the UI can say "consolidated from N currencies"). */
export interface CurrencyMix {
  currency: string;
  projects: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Coerce a possibly-dirty financial amount (string, null, NaN, Infinity) to a finite number, else 0. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** A roll-up row mid-fold: carries the set of source currencies seen so far, so `fold` can tell
 *  whether the row is still single-currency (and so can show a `local` figure) or has gone mixed. */
interface WorkingRollup extends FinanceRollup {
  _currencies: Set<string>;
}

function blank(key: string, label: string): WorkingRollup {
  return { key, label, projects: 0, budget: 0, actual: 0, forecast: 0, earnedValue: 0, variance: 0, cpi: null, localCurrency: null, local: null, _currencies: new Set() };
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
  acc.budget += conv(raw.budget);
  acc.actual += conv(raw.actual);
  acc.forecast += conv(raw.forecast);
  acc.earnedValue += conv(raw.earnedValue);

  acc._currencies.add(currency);
  if (acc._currencies.size === 1) {
    acc.localCurrency = currency;
    const local = acc.local ?? { budget: 0, actual: 0, forecast: 0, earnedValue: 0 };
    local.budget += raw.budget;
    local.actual += raw.actual;
    local.forecast += raw.forecast;
    local.earnedValue += raw.earnedValue;
    acc.local = local;
  } else {
    // A second distinct currency showed up — the row is mixed, a single local figure no longer applies.
    acc.localCurrency = null;
    acc.local = null;
  }
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
