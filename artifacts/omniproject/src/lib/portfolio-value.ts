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

/** Track whether every project folded into a row so far shares one source currency, so the row can
 *  show a `local` (un-converted) figure alongside the consolidated total. Once a second currency
 *  shows up the row is "mixed" and only the consolidated total applies. Shared by both roll-ups. */
class LocalTracker {
  currency: string | null = null;
  private seen = new Set<string>();

  /** Fold one more project's currency in; returns true while the row is still single-currency. */
  add(currency: string): boolean {
    this.seen.add(currency);
    this.currency = this.seen.size === 1 ? currency : null;
    return this.seen.size === 1;
  }
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
}

interface WorkingIncomeRollup extends IncomeRollup {
  _tracker: LocalTracker;
}

function blankIncome(key: string, label: string): WorkingIncomeRollup {
  return { key, label, projects: 0, projected: 0, invoiced: 0, unbilled: 0, billedPct: 0, localCurrency: null, local: null, _tracker: new LocalTracker() };
}

function finaliseIncome(r: WorkingIncomeRollup): IncomeRollup {
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    projected: round2(r.projected),
    invoiced: round2(r.invoiced),
    unbilled: round2(Math.max(0, r.projected - r.invoiced)),
    billedPct: r.projected > 0 ? Math.round((r.invoiced / r.projected) * 1000) / 10 : 0,
    localCurrency: r._tracker.currency,
    local: r.local ? { projected: round2(r.local.projected), invoiced: round2(r.local.invoiced) } : null,
  };
}

/** Consolidate projects' income into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupIncome(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: IncomeRollup[]; portfolio: IncomeRollup } {
  const groups = new Map<string, WorkingIncomeRollup>();
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
      if (acc._tracker.add(p.currency)) {
        const local = acc.local ?? { projected: 0, invoiced: 0 };
        local.projected += s.projected;
        local.invoiced += s.invoiced;
        acc.local = local;
      } else {
        acc.local = null;
      }
    }
    groups.set(key, row);
  }
  // key (the programmeId) is unique per group ⇒ deterministic order for equal unbilled value.
  const programmes = [...groups.values()].map(finaliseIncome).sort((a, b) => b.unbilled - a.unbilled || a.key.localeCompare(b.key));
  return { programmes, portfolio: finaliseIncome(portfolio) };
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
}

interface WorkingBenefitsRollup extends BenefitsRollup {
  _tracker: LocalTracker;
}

function blankBenefits(key: string, label: string): WorkingBenefitsRollup {
  return { key, label, projects: 0, planned: 0, actual: 0, expected: 0, realisation: 0, localCurrency: null, local: null, _tracker: new LocalTracker() };
}

function finaliseBenefits(r: WorkingBenefitsRollup): BenefitsRollup {
  return {
    key: r.key,
    label: r.label,
    projects: r.projects,
    planned: round2(r.planned),
    actual: round2(r.actual),
    expected: round2(r.expected),
    realisation: r.planned > 0 ? Math.round((r.actual / r.planned) * 1000) / 10 : 0,
    localCurrency: r._tracker.currency,
    local: r.local ? { planned: round2(r.local.planned), actual: round2(r.local.actual), expected: round2(r.local.expected) } : null,
  };
}

/** Consolidate projects' benefits into programme roll-ups + portfolio total, in `reportingCurrency`. */
export function rollupBenefits(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>): { programmes: BenefitsRollup[]; portfolio: BenefitsRollup } {
  const groups = new Map<string, WorkingBenefitsRollup>();
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
      if (acc._tracker.add(p.currency)) {
        const local = acc.local ?? { planned: 0, actual: 0, expected: 0 };
        local.planned += s.totalPlanned;
        local.actual += s.totalActual;
        local.expected += s.expectedValue;
        acc.local = local;
      } else {
        acc.local = null;
      }
    }
    groups.set(key, row);
  }
  // Worst realisation first so shortfall surfaces; key breaks ties deterministically.
  const programmes = [...groups.values()].map(finaliseBenefits).sort((a, b) => a.realisation - b.realisation || a.key.localeCompare(b.key));
  return { programmes, portfolio: finaliseBenefits(portfolio) };
}
