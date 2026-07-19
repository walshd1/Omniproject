import { rollupBenefits, type BenefitsRollup } from "../../lib/portfolio-value";
import { PortfolioValueReport } from "./PortfolioValueReport";

/**
 * Portfolio Benefits roll-up — planned vs realised benefit value across every project, consolidated into
 * one reporting currency and grouped by programme, worst-realisation first. Answers "are we delivering
 * the value we funded?" at portfolio scale. STATELESS: derived live from work items + the FX table.
 */
export function PortfolioBenefits() {
  return (
    <PortfolioValueReport<BenefitsRollup, BenefitsRollup>
      testId="portfolio-benefits"
      rollup={rollupBenefits}
      isEmpty={(p) => p.planned === 0 && p.actual === 0}
      emptyHint="No benefits data — set planned and actual benefit values on work items to track realisation across the portfolio."
      stats={(p, money) => [
        { label: "Planned benefit", value: money(p.planned), hint: `${p.projects} project(s)` },
        { label: "Realised", value: money(p.actual), hint: `${p.realisation}% realised` },
        { label: "Expected (risk-adj.)", value: money(p.expected), hint: "planned × confidence" },
        { label: "Realisation", value: `${p.realisation}%`, hint: p.realisation >= 100 ? "target met" : "value outstanding" },
      ]}
      localLine={(r) => (r.local ? { amount: r.local.planned, noun: "planned" } : null)}
      columns={(money) => [
        { header: "Planned", align: "right", cell: (r) => money(r.planned) },
        { header: "Realised", align: "right", cell: (r) => money(r.actual) },
        { header: "Expected", align: "right", cell: (r) => money(r.expected), cellClassName: "text-muted-foreground" },
        { header: "Realisation", align: "right", cell: (r) => `${r.realisation}%`, cellClassName: (r) => `font-black ${r.realisation < 50 ? "text-red-500" : r.realisation >= 100 ? "text-green-600" : ""}` },
      ]}
      footnote={(target) => ({
        lead: `Planned vs realised benefit value, consolidated into ${target} and grouped by programme (worst realisation first).`,
        mid: "Expected is the confidence-weighted forecast.",
      })}
    />
  );
}
