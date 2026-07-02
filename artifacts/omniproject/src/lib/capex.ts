/**
 * CapEx / OpEx — a pure, STATELESS roll-up over the canonical `expenditureType` /
 * `capexAmount` / `opexAmount` / `costCategory` / `depreciationMonths` fields.
 *
 * It splits spend into capital vs operating, rolls up by cost category, and derives the
 * annualised capital charge from each item's depreciation period. When a backend supplies
 * only `expenditureType` + a cost figure (no explicit split), the whole cost is allocated to
 * the declared side. Nothing is stored.
 */
import { num } from "./num";

export interface CapexInput {
  id: string;
  title: string;
  expenditureType?: string | null;
  capexAmount?: number | null;
  opexAmount?: number | null;
  costCategory?: string | null;
  depreciationMonths?: number | null;
  actualCost?: number | null;
  budget?: number | null;
}

export interface CapexRow {
  id: string;
  title: string;
  capex: number;
  opex: number;
  category: string;
  /** capex spread over its useful life, per year (0 when no depreciation period). */
  annualCharge: number;
}

export interface CategoryRoll {
  category: string;
  capex: number;
  opex: number;
  total: number;
}

export interface CapexSummary {
  count: number;
  totalCapex: number;
  totalOpex: number;
  total: number;
  /** capex / (capex + opex); 0 when nothing classified. */
  capexPct: number;
  /** Σ capex / (depreciationMonths / 12) — the annual P&L charge from capitalised spend. */
  annualisedCapex: number;
  byCategory: CategoryRoll[];
  rows: CapexRow[];
}

const UNCATEGORISED = "Uncategorised";

/**
 * Resolve an item's capex/opex split. Explicit amounts win; otherwise, when the item declares
 * an `expenditureType` and carries a cost figure (actualCost, else budget), the whole figure is
 * allocated to the declared side (`mixed`/unknown ⇒ left unallocated).
 */
export function splitExpenditure(i: CapexInput): { capex: number; opex: number } {
  const capex = num(i.capexAmount);
  const opex = num(i.opexAmount);
  if (capex > 0 || opex > 0) return { capex, opex };
  const type = (i.expenditureType ?? "").toLowerCase();
  const cost = num(i.actualCost) || num(i.budget);
  if (cost <= 0) return { capex: 0, opex: 0 };
  if (type === "capex" || type === "capital") return { capex: cost, opex: 0 };
  if (type === "opex" || type === "operating") return { capex: 0, opex: cost };
  return { capex: 0, opex: 0 };
}

/** A work item is in scope when it has any split or declares an expenditure type. */
export function isCosted(i: CapexInput): boolean {
  const { capex, opex } = splitExpenditure(i);
  return capex > 0 || opex > 0;
}

export function summariseCapex(items: readonly CapexInput[]): CapexSummary {
  const rows: CapexRow[] = [];
  const cats = new Map<string, CategoryRoll>();
  let totalCapex = 0;
  let totalOpex = 0;
  let annualisedCapex = 0;

  for (const i of items) {
    const { capex, opex } = splitExpenditure(i);
    if (capex <= 0 && opex <= 0) continue;
    const category = (i.costCategory ?? "").trim() || UNCATEGORISED;
    const dep = num(i.depreciationMonths);
    const annualCharge = dep > 0 ? capex / (dep / 12) : 0;

    totalCapex += capex;
    totalOpex += opex;
    annualisedCapex += annualCharge;

    let roll = cats.get(category);
    if (!roll) { roll = { category, capex: 0, opex: 0, total: 0 }; cats.set(category, roll); }
    roll.capex += capex;
    roll.opex += opex;
    roll.total += capex + opex;

    rows.push({ id: i.id, title: i.title, capex, opex, category, annualCharge });
  }

  const total = totalCapex + totalOpex;
  rows.sort((a, b) => b.capex + b.opex - (a.capex + a.opex));
  const byCategory = [...cats.values()].sort((a, b) => b.total - a.total);

  return {
    count: rows.length,
    totalCapex,
    totalOpex,
    total,
    capexPct: total > 0 ? totalCapex / total : 0,
    annualisedCapex,
    byCategory,
    rows,
  };
}
