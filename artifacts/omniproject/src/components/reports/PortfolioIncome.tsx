import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { rollupIncome } from "../../lib/portfolio-value";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable } from "./ReportTable";
import { usePortfolioItems } from "./use-portfolio-items";

/**
 * Portfolio Income roll-up — projected income vs invoiced across every project, consolidated into one
 * reporting currency and grouped by programme. The board-level billing view for a head of projects.
 * STATELESS: derived live from work items + the FX table; nothing is stored.
 */
export function PortfolioIncome() {
  const { formatCurrency } = useT();
  const { projects, loading, isError, error, refetch, target, rates, fx } = usePortfolioItems();
  const { programmes, portfolio } = useMemo(() => rollupIncome(projects, target, rates), [projects, target, rates]);
  const money = (n: number) => formatCurrency(n, target);

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {portfolio.projected === 0 && portfolio.invoiced === 0 ? (
        <ReportEmpty testId="portfolio-income-empty">
          No income data — set projected income (revenue) and invoiced amounts on work items to track billing across the portfolio.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="portfolio-income">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projected income" value={money(portfolio.projected)} hint={`${portfolio.projects} project(s)`} />
            <StatCard label="Invoiced" value={money(portfolio.invoiced)} hint={`${portfolio.billedPct}% billed`} />
            <StatCard label="Unbilled" value={money(portfolio.unbilled)} hint="projected − invoiced" />
            <StatCard label="Billed" value={`${portfolio.billedPct}%`} hint={portfolio.billedPct >= 100 ? "fully invoiced" : "billing outstanding"} />
          </div>
          <ReportTable
            rows={programmes}
            rowKey={(r) => r.key}
            rowTestId={(r) => `portfolio-income-row-${r.key}`}
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
                        <div className="text-[10px] font-normal text-muted-foreground" data-testid={`portfolio-income-row-${r.key}-local`}>
                          {formatCurrency(r.local!.projected, r.localCurrency!)} local projected
                        </div>
                      )}
                    </>
                  );
                },
              },
              { header: "Projects", align: "right", cell: (r) => r.projects, cellClassName: "text-muted-foreground" },
              { header: "Projected", align: "right", cell: (r) => money(r.projected) },
              { header: "Invoiced", align: "right", cell: (r) => money(r.invoiced) },
              { header: "Unbilled", align: "right", cell: (r) => (r.unbilled ? money(r.unbilled) : "—"), cellClassName: "text-amber-600" },
              { header: "Billed", align: "right", cell: (r) => `${r.billedPct}%` },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Projected income vs invoiced, consolidated into {target} and grouped by programme.
            {fx?.provenance ? ` FX ${fx.provenance}${fx.asOf ? ` as of ${new Date(fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""}.` : ""} The
            unbilled column is revenue still to bill. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
