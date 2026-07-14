import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { rollupBenefits } from "../../lib/portfolio-value";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable } from "./ReportTable";
import { usePortfolioItems } from "./use-portfolio-items";

/**
 * Portfolio Benefits roll-up — planned vs realised benefit value across every project, consolidated into
 * one reporting currency and grouped by programme, worst-realisation first. Answers "are we delivering
 * the value we funded?" at portfolio scale. STATELESS: derived live from work items + the FX table.
 */
export function PortfolioBenefits() {
  const { formatCurrency } = useT();
  const { projects, loading, isError, error, refetch, target, rates, fx } = usePortfolioItems();
  const { programmes, portfolio } = useMemo(() => rollupBenefits(projects, target, rates), [projects, target, rates]);
  const money = (n: number) => formatCurrency(n, target);

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {portfolio.planned === 0 && portfolio.actual === 0 ? (
        <ReportEmpty testId="portfolio-benefits-empty">
          No benefits data — set planned and actual benefit values on work items to track realisation across the portfolio.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="portfolio-benefits">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Planned benefit" value={money(portfolio.planned)} hint={`${portfolio.projects} project(s)`} />
            <StatCard label="Realised" value={money(portfolio.actual)} hint={`${portfolio.realisation}% realised`} />
            <StatCard label="Expected (risk-adj.)" value={money(portfolio.expected)} hint="planned × confidence" />
            <StatCard label="Realisation" value={`${portfolio.realisation}%`} hint={portfolio.realisation >= 100 ? "target met" : "value outstanding"} />
          </div>
          <ReportTable
            rows={programmes}
            rowKey={(r) => r.key}
            rowTestId={(r) => `portfolio-benefits-row-${r.key}`}
            size="comfortable"
            columns={[
              {
                header: "Programme",
                cellClassName: "font-bold",
                cell: (r) => {
                  const showLocal = !!r.localCurrency && r.localCurrency !== target && !!r.local;
                  return (
                    <>
                      {r.label}
                      {showLocal && (
                        <div className="text-[10px] font-normal text-muted-foreground" data-testid={`portfolio-benefits-row-${r.key}-local`}>
                          {formatCurrency(r.local!.planned, r.localCurrency!)} local planned
                        </div>
                      )}
                    </>
                  );
                },
              },
              { header: "Projects", align: "right", cell: (r) => r.projects, cellClassName: "text-muted-foreground" },
              { header: "Planned", align: "right", cell: (r) => money(r.planned) },
              { header: "Realised", align: "right", cell: (r) => money(r.actual) },
              { header: "Expected", align: "right", cell: (r) => money(r.expected), cellClassName: "text-muted-foreground" },
              { header: "Realisation", align: "right", cell: (r) => `${r.realisation}%`, cellClassName: (r) => `font-black ${r.realisation < 50 ? "text-red-500" : r.realisation >= 100 ? "text-green-600" : ""}` },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Planned vs realised benefit value, consolidated into {target} and grouped by programme (worst realisation first).
            {fx?.provenance ? ` FX ${fx.provenance}${fx.asOf ? ` as of ${new Date(fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""}.` : ""} Expected
            is the confidence-weighted forecast. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
