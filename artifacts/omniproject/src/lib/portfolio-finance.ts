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
}

/** Distinct source currencies seen across the projects (so the UI can say "consolidated from N currencies"). */
export interface CurrencyMix {
  currency: string;
  projects: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function blank(key: string, label: string): FinanceRollup {
  return { key, label, projects: 0, budget: 0, actual: 0, forecast: 0, earnedValue: 0, variance: 0, cpi: null };
}

/** Fold one project's financials (converted to the reporting currency) into a roll-up row. */
function fold(acc: FinanceRollup, p: ProjectFin, target: string, rates?: Record<string, number>): void {
  const conv = (n: number) => convertAmount(n, p.fin.currency, target, rates);
  acc.projects += 1;
  acc.budget += conv(p.fin.budgetAllocated);
  acc.actual += conv(p.fin.actualBurn);
  acc.forecast += conv(p.fin.forecastCostAtCompletion);
  acc.earnedValue += conv(p.fin.earnedValue);
}

/** Finalise the derived fields (variance + consolidated CPI) and round the money. */
function finalise(r: FinanceRollup): FinanceRollup {
  return {
    ...r,
    budget: round2(r.budget),
    actual: round2(r.actual),
    forecast: round2(r.forecast),
    earnedValue: round2(r.earnedValue),
    variance: round2(r.budget - r.forecast),
    cpi: r.actual > 0 ? Math.round((r.earnedValue / r.actual) * 100) / 100 : null,
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
  const groups = new Map<string, FinanceRollup>();
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
  const programmes = [...groups.values()].map(finalise).sort((a, b) => a.variance - b.variance);
  const currencyMix = [...mix.entries()].map(([currency, n]) => ({ currency, projects: n })).sort((a, b) => b.projects - a.projects);
  return { programmes, portfolio: finalise(portfolio), currencyMix };
}
