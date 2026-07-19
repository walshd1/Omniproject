import {
  consolidateByGroup,
  consolidationSpec,
  type ConsolidatedRow,
  type ConsolidationInput,
} from "@workspace/backend-catalogue";
import { summariseIncome, type IncomeInput } from "./income";
import { summariseBenefits, type BenefitInput } from "./benefits";

/**
 * Portfolio value roll-ups — consolidate each project's INCOME (projected vs invoiced) and BENEFITS
 * (planned vs realised) into one reporting currency and group by programme. The consolidation itself (the
 * group → FX-convert → local-track → derive → sort fold) is the shared, JSON-spec-driven `consolidateByGroup`
 * engine; the roll-up SHAPE (which measures, the derived metric, the sort) is authored as data under
 * assets/consolidations/. This module only extracts each project's measure values from its work items (the
 * income/benefit summarisers) and re-labels the generic result into the report's named row type. Pure and
 * derive-only: nothing is stored.
 */

/** One project's work items, tagged with programme + currency for grouping and conversion. */
export interface ProjectItems {
  projectId: string;
  projectName: string;
  programmeId: string | null;
  programmeName: string | null;
  currency: string;
  items: (IncomeInput & BenefitInput)[];
}

const STANDALONE = "__standalone__";

/** Build the generic consolidation inputs — group key/label + currency + the per-measure values a
 *  project contributes (extracted from its work items by `measures`). */
function toInputs(projects: ProjectItems[], measures: (p: ProjectItems) => Record<string, number>): ConsolidationInput[] {
  return projects.map((p) => ({
    groupKey: p.programmeId ?? STANDALONE,
    groupLabel: p.programmeId ? (p.programmeName ?? p.programmeId) : "Standalone",
    currency: p.currency,
    values: measures(p),
  }));
}

// ── Income roll-up ───────────────────────────────────────────────────────────

/** A row's un-converted income totals in its own `localCurrency`. */
export interface LocalIncomeTotals {
  projected: number;
  invoiced: number;
}

export interface IncomeRollup {
  key: string;
  label: string;
  projects: number;
  projected: number;
  invoiced: number;
  unbilled: number;
  /** invoiced ÷ projected × 100 (0 when nothing projected). */
  billedPct: number;
  /** The single local currency shared by every project folded into this row, or null once it mixes
   *  ≥2 currencies (only the consolidated total applies then). */
  localCurrency: string | null;
  /** Un-converted totals in `localCurrency` — present only while the row is single-currency. */
  local: LocalIncomeTotals | null;
  /** Projects excluded from the consolidated total because their currency has no rate to the
   *  reporting currency (summing the raw foreign amount would corrupt the total). */
  excludedForFx: number;
}

const INCOME_SPEC = consolidationSpec("income");

/** Re-label a generic consolidated row as an income roll-up. */
function toIncomeRollup(r: ConsolidatedRow): IncomeRollup {
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    projected: (r.metrics["projected"] as number) ?? 0,
    invoiced: (r.metrics["invoiced"] as number) ?? 0,
    unbilled: (r.metrics["unbilled"] as number) ?? 0,
    billedPct: (r.metrics["billedPct"] as number) ?? 0,
    localCurrency: r.localCurrency,
    local: r.local ? { projected: r.local["projected"] ?? 0, invoiced: r.local["invoiced"] ?? 0 } : null,
    excludedForFx: r.excludedForFx,
  };
}

/** Consolidate projects' income into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupIncome(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: IncomeRollup[]; portfolio: IncomeRollup } {
  const inputs = toInputs(projects, (p) => {
    const s = summariseIncome(p.items);
    return { projected: s.projected, invoiced: s.invoiced };
  });
  const { groups, total } = consolidateByGroup(inputs, INCOME_SPEC, reportingCurrency, rates);
  return { programmes: groups.map(toIncomeRollup), portfolio: toIncomeRollup(total) };
}

// ── Benefits roll-up ─────────────────────────────────────────────────────────

/** A row's un-converted benefit totals in its own `localCurrency`. */
export interface LocalBenefitTotals {
  planned: number;
  actual: number;
  expected: number;
}

export interface BenefitsRollup {
  key: string;
  label: string;
  projects: number;
  planned: number;
  actual: number;
  /** Σ planned × confidence — the risk-adjusted forecast. */
  expected: number;
  /** actual ÷ planned × 100 (0 when nothing planned). */
  realisation: number;
  /** The single local currency shared by every project folded into this row, or null once it mixes
   *  ≥2 currencies (only the consolidated total applies then). */
  localCurrency: string | null;
  /** Un-converted totals in `localCurrency` — present only while the row is single-currency. */
  local: LocalBenefitTotals | null;
  /** Projects excluded from the consolidated total because their currency has no rate to the
   *  reporting currency (summing the raw foreign amount would corrupt the total). */
  excludedForFx: number;
}

const BENEFITS_SPEC = consolidationSpec("benefits");

/** Re-label a generic consolidated row as a benefits roll-up. */
function toBenefitsRollup(r: ConsolidatedRow): BenefitsRollup {
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    planned: (r.metrics["planned"] as number) ?? 0,
    actual: (r.metrics["actual"] as number) ?? 0,
    expected: (r.metrics["expected"] as number) ?? 0,
    realisation: (r.metrics["realisation"] as number) ?? 0,
    localCurrency: r.localCurrency,
    local: r.local ? { planned: r.local["planned"] ?? 0, actual: r.local["actual"] ?? 0, expected: r.local["expected"] ?? 0 } : null,
    excludedForFx: r.excludedForFx,
  };
}

/** Consolidate projects' benefits into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupBenefits(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: BenefitsRollup[]; portfolio: BenefitsRollup } {
  const inputs = toInputs(projects, (p) => {
    const s = summariseBenefits(p.items);
    return { planned: s.totalPlanned, actual: s.totalActual, expected: s.expectedValue };
  });
  const { groups, total } = consolidateByGroup(inputs, BENEFITS_SPEC, reportingCurrency, rates);
  return { programmes: groups.map(toBenefitsRollup), portfolio: toBenefitsRollup(total) };
}
