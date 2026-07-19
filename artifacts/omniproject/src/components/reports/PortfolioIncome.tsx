import { rollupIncome, type IncomeRollup } from "../../lib/portfolio-value";
import { PortfolioValueReport } from "./PortfolioValueReport";

/**
 * Portfolio Income roll-up — projected income vs invoiced across every project, consolidated into one
 * reporting currency and grouped by programme. The board-level billing view for a head of projects.
 * STATELESS: derived live from work items + the FX table; nothing is stored.
 */
export function PortfolioIncome() {
  return (
    <PortfolioValueReport<IncomeRollup, IncomeRollup>
      testId="portfolio-income"
      rollup={rollupIncome}
      isEmpty={(p) => p.projected === 0 && p.invoiced === 0}
      emptyHint="No income data — set projected income (revenue) and invoiced amounts on work items to track billing across the portfolio."
      stats={(p, money) => [
        { label: "Projected income", value: money(p.projected), hint: `${p.projects} project(s)` },
        { label: "Invoiced", value: money(p.invoiced), hint: `${p.billedPct}% billed` },
        { label: "Unbilled", value: money(p.unbilled), hint: "projected − invoiced" },
        { label: "Billed", value: `${p.billedPct}%`, hint: p.billedPct >= 100 ? "fully invoiced" : "billing outstanding" },
      ]}
      localLine={(r) => (r.local ? { amount: r.local.projected, noun: "projected" } : null)}
      columns={(money) => [
        { header: "Projected", align: "right", cell: (r) => money(r.projected) },
        { header: "Invoiced", align: "right", cell: (r) => money(r.invoiced) },
        { header: "Unbilled", align: "right", cell: (r) => (r.unbilled ? money(r.unbilled) : "—"), cellClassName: "text-amber-600" },
        { header: "Billed", align: "right", cell: (r) => `${r.billedPct}%` },
      ]}
      footnote={(target) => ({
        lead: `Projected income vs invoiced, consolidated into ${target} and grouped by programme.`,
        mid: "The unbilled column is revenue still to bill.",
      })}
    />
  );
}
