import { PortfolioValueReport } from "./PortfolioValueReport";

/**
 * Portfolio Benefits roll-up — planned vs realised benefit value across every project, consolidated into
 * one reporting currency and grouped by programme, worst-realisation first. Answers "are we delivering the
 * value we funded?" at portfolio scale. The consolidation is the `benefits` JSON spec run by the shared
 * engine; this file only binds the report's columns to the metric keys that spec declares. STATELESS.
 */
export function PortfolioBenefits() {
  const n = (v: number | null | undefined) => v ?? 0;
  return (
    <PortfolioValueReport
      testId="portfolio-benefits"
      specId="benefits"
      isEmpty={(p) => n(p.metrics["planned"]) === 0 && n(p.metrics["actual"]) === 0}
      emptyHint="No benefits data — set planned and actual benefit values on work items to track realisation across the portfolio."
      stats={(p, money) => [
        { label: "Planned benefit", value: money(n(p.metrics["planned"])), hint: `${p.projects} project(s)` },
        { label: "Realised", value: money(n(p.metrics["actual"])), hint: `${n(p.metrics["realisation"])}% realised` },
        { label: "Expected (risk-adj.)", value: money(n(p.metrics["expected"])), hint: "planned × confidence" },
        { label: "Realisation", value: `${n(p.metrics["realisation"])}%`, hint: n(p.metrics["realisation"]) >= 100 ? "target met" : "value outstanding" },
      ]}
      localLine={(r) => (r.local ? { amount: n(r.local["planned"]), noun: "planned" } : null)}
      columns={(money) => [
        { header: "Planned", align: "right", cell: (r) => money(n(r.metrics["planned"])) },
        { header: "Realised", align: "right", cell: (r) => money(n(r.metrics["actual"])) },
        { header: "Expected", align: "right", cell: (r) => money(n(r.metrics["expected"])), cellClassName: "text-muted-foreground" },
        { header: "Realisation", align: "right", cell: (r) => `${n(r.metrics["realisation"])}%`, cellClassName: (r) => `font-black ${n(r.metrics["realisation"]) < 50 ? "text-red-500" : n(r.metrics["realisation"]) >= 100 ? "text-green-600" : ""}` },
      ]}
      footnote={(target) => ({
        lead: `Planned vs realised benefit value, consolidated into ${target} and grouped by programme (worst realisation first).`,
        mid: "Expected is the confidence-weighted forecast.",
      })}
    />
  );
}
