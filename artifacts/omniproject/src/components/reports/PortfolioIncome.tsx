import { PortfolioValueReport } from "./PortfolioValueReport";

/**
 * Portfolio Income roll-up — projected income vs invoiced across every project, consolidated into one
 * reporting currency and grouped by programme. The board-level billing view for a head of projects. The
 * consolidation is the `income` JSON spec run by the shared engine; this file only binds the report's
 * columns to the metric keys that spec declares. STATELESS: derived live; nothing is stored.
 */
export function PortfolioIncome() {
  const n = (v: number | null | undefined) => v ?? 0;
  return (
    <PortfolioValueReport
      testId="portfolio-income"
      specId="income"
      isEmpty={(p) => n(p.metrics["projected"]) === 0 && n(p.metrics["invoiced"]) === 0}
      emptyHint="No income data — set projected income (revenue) and invoiced amounts on work items to track billing across the portfolio."
      stats={(p, money) => [
        { label: "Projected income", value: money(n(p.metrics["projected"])), hint: `${p.projects} project(s)` },
        { label: "Invoiced", value: money(n(p.metrics["invoiced"])), hint: `${n(p.metrics["billedPct"])}% billed` },
        { label: "Unbilled", value: money(n(p.metrics["unbilled"])), hint: "projected − invoiced" },
        { label: "Billed", value: `${n(p.metrics["billedPct"])}%`, hint: n(p.metrics["billedPct"]) >= 100 ? "fully invoiced" : "billing outstanding" },
      ]}
      localLine={(r) => (r.local ? { amount: n(r.local["projected"]), noun: "projected" } : null)}
      columns={(money) => [
        { header: "Projected", align: "right", cell: (r) => money(n(r.metrics["projected"])) },
        { header: "Invoiced", align: "right", cell: (r) => money(n(r.metrics["invoiced"])) },
        { header: "Unbilled", align: "right", cell: (r) => (n(r.metrics["unbilled"]) ? money(n(r.metrics["unbilled"])) : "—"), cellClassName: "text-amber-600" },
        { header: "Billed", align: "right", cell: (r) => `${n(r.metrics["billedPct"])}%` },
      ]}
      footnote={(target) => ({
        lead: `Projected income vs invoiced, consolidated into ${target} and grouped by programme.`,
        mid: "The unbilled column is revenue still to bill.",
      })}
    />
  );
}
