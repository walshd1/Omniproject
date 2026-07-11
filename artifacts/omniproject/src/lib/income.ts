/**
 * Income & invoicing summary — projected income (revenue) vs what's actually been invoiced, per work
 * item, with the unbilled gap and purchase-order references. Pure and derive-only: reads the canonical
 * `revenue` / `invoicedAmount` / `purchaseOrder` fields the backend surfaces; OmniProject stores nothing.
 */
import { num, round2 } from "./num";

export interface IncomeInput {
  id: string;
  title?: string | null;
  revenue?: number | null;
  invoicedAmount?: number | null;
  purchaseOrder?: string | null;
}

export interface IncomeRow {
  id: string;
  title: string;
  /** Projected / recognised income. */
  revenue: number;
  /** Invoiced to date. */
  invoiced: number;
  /** revenue − invoiced: income earned/projected but not yet billed. */
  unbilled: number;
  purchaseOrder: string | null;
}

export interface IncomeSummary {
  projected: number;
  invoiced: number;
  /** projected − invoiced (clamped at 0 — over-invoicing shows on the row, not as negative backlog). */
  unbilled: number;
  /** invoiced ÷ projected (0 when nothing is projected). */
  billedPct: number;
  /** Items carrying any income signal. */
  count: number;
  rows: IncomeRow[];
}

/** True when an item carries any income signal (projected or invoiced). */
export function hasIncome(i: IncomeInput): boolean {
  return num(i.revenue) !== 0 || num(i.invoicedAmount) !== 0;
}

export function summariseIncome(items: readonly IncomeInput[]): IncomeSummary {
  const rows: IncomeRow[] = [];
  let projected = 0;
  let invoiced = 0;
  for (const i of items) {
    if (!hasIncome(i)) continue;
    const revenue = num(i.revenue);
    const inv = num(i.invoicedAmount);
    projected += revenue;
    invoiced += inv;
    rows.push({
      id: i.id,
      title: i.title ?? i.id,
      revenue,
      invoiced: inv,
      unbilled: round2(revenue - inv),
      purchaseOrder: i.purchaseOrder ?? null,
    });
  }
  rows.sort((a, b) => b.unbilled - a.unbilled);
  return {
    projected: round2(projected),
    invoiced: round2(invoiced),
    unbilled: round2(Math.max(0, projected - invoiced)),
    billedPct: projected > 0 ? Math.round((invoiced / projected) * 1000) / 10 : 0,
    count: rows.length,
    rows,
  };
}
