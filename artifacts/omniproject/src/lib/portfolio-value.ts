import { convertAmount } from "./currency";
import { summariseIncome, type IncomeInput } from "./income";
import { summariseBenefits, type BenefitInput } from "./benefits";

/**
 * Portfolio value roll-ups — consolidate each project's INCOME (projected vs invoiced) and BENEFITS
 * (planned vs realised) into one reporting currency and group by programme. Pure and derive-only: the
 * caller supplies each project's work items + currency + the FX table; nothing is stored. Mirrors the
 * financial-consolidation pattern so income/benefit roll-ups read identically to the budget one.
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

const round2 = (n: number) => Math.round(n * 100) / 100;
const STANDALONE = "__standalone__";

function groupKeyLabel(p: ProjectItems): { key: string; label: string } {
  return p.programmeId ? { key: p.programmeId, label: p.programmeName ?? p.programmeId } : { key: STANDALONE, label: "Standalone" };
}

// ── Income roll-up ───────────────────────────────────────────────────────────

export interface IncomeRollup {
  key: string;
  label: string;
  projects: number;
  projected: number;
  invoiced: number;
  unbilled: number;
  /** invoiced ÷ projected × 100 (0 when nothing projected). */
  billedPct: number;
}

function blankIncome(key: string, label: string): IncomeRollup {
  return { key, label, projects: 0, projected: 0, invoiced: 0, unbilled: 0, billedPct: 0 };
}

function finaliseIncome(r: IncomeRollup): IncomeRollup {
  return {
    ...r,
    projected: round2(r.projected),
    invoiced: round2(r.invoiced),
    unbilled: round2(Math.max(0, r.projected - r.invoiced)),
    billedPct: r.projected > 0 ? Math.round((r.invoiced / r.projected) * 1000) / 10 : 0,
  };
}

/** Consolidate projects' income into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupIncome(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: IncomeRollup[]; portfolio: IncomeRollup } {
  const groups = new Map<string, IncomeRollup>();
  const portfolio = blankIncome("__portfolio__", "Portfolio");
  for (const p of projects) {
    const s = summariseIncome(p.items);
    const conv = (n: number) => convertAmount(n, p.currency, reportingCurrency, rates);
    const { key, label } = groupKeyLabel(p);
    const row = groups.get(key) ?? blankIncome(key, label);
    for (const acc of [row, portfolio]) {
      acc.projects += 1;
      acc.projected += conv(s.projected);
      acc.invoiced += conv(s.invoiced);
    }
    groups.set(key, row);
  }
  // key (the programmeId) is unique per group ⇒ deterministic order for equal unbilled value.
  const programmes = [...groups.values()].map(finaliseIncome).sort((a, b) => b.unbilled - a.unbilled || a.key.localeCompare(b.key));
  return { programmes, portfolio: finaliseIncome(portfolio) };
}

// ── Benefits roll-up ─────────────────────────────────────────────────────────

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
}

function blankBenefits(key: string, label: string): BenefitsRollup {
  return { key, label, projects: 0, planned: 0, actual: 0, expected: 0, realisation: 0 };
}

function finaliseBenefits(r: BenefitsRollup): BenefitsRollup {
  return {
    ...r,
    planned: round2(r.planned),
    actual: round2(r.actual),
    expected: round2(r.expected),
    realisation: r.planned > 0 ? Math.round((r.actual / r.planned) * 1000) / 10 : 0,
  };
}

/** Consolidate projects' benefits into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupBenefits(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: BenefitsRollup[]; portfolio: BenefitsRollup } {
  const groups = new Map<string, BenefitsRollup>();
  const portfolio = blankBenefits("__portfolio__", "Portfolio");
  for (const p of projects) {
    const s = summariseBenefits(p.items);
    const conv = (n: number) => convertAmount(n, p.currency, reportingCurrency, rates);
    const { key, label } = groupKeyLabel(p);
    const row = groups.get(key) ?? blankBenefits(key, label);
    for (const acc of [row, portfolio]) {
      acc.projects += 1;
      acc.planned += conv(s.totalPlanned);
      acc.actual += conv(s.totalActual);
      acc.expected += conv(s.expectedValue);
    }
    groups.set(key, row);
  }
  // Worst realisation first so shortfall surfaces; key breaks ties deterministically.
  const programmes = [...groups.values()].map(finaliseBenefits).sort((a, b) => a.realisation - b.realisation || a.key.localeCompare(b.key));
  return { programmes, portfolio: finaliseBenefits(portfolio) };
}
