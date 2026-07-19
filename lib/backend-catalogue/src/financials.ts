/**
 * Financials binding — the finance-specific layer over the generic consolidation engine: it names the
 * budget / actual / forecast / earned-value fields the `/api/portfolio/financials` wire contract exposes and
 * maps a generic consolidated row onto them. The FOLD is not here (that is `consolidation.ts` run with the
 * `financials` spec); this is only the data-specific binding — the field names live in the spec + this
 * contract shape, not in a re-implemented roll-up. Shared by the SPA report and the gateway fan-out.
 */
import { consolidateByGroup, consolidationSpec, type ConsolidatedRow, type ConsolidationInput } from "./consolidation";

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
 * A thin caller of the generic `consolidateByGroup` engine driven by the `financials` consolidation spec —
 * the group → FX-convert → local-track → derive fold is not re-implemented here. The currency mix is a plain
 * tally the engine doesn't produce, so it stays.
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
