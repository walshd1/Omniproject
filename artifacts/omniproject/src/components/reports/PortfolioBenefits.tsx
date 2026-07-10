import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { rollupBenefits } from "../../lib/portfolio-value";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projects</th>
                  <th className="py-1.5 px-2 font-bold text-right">Planned</th>
                  <th className="py-1.5 px-2 font-bold text-right">Realised</th>
                  <th className="py-1.5 px-2 font-bold text-right">Expected</th>
                  <th className="py-1.5 px-2 font-bold text-right">Realisation</th>
                </tr>
              </thead>
              <tbody>
                {programmes.map((r) => {
                  const showLocal = !!r.localCurrency && r.localCurrency !== target && !!r.local;
                  return (
                    <tr key={r.key} className="border-b border-border/50" data-testid={`portfolio-benefits-row-${r.key}`}>
                      <td className="py-2 pr-3 font-bold">
                        {r.label}
                        {showLocal && (
                          <div className="text-[10px] font-normal text-muted-foreground" data-testid={`portfolio-benefits-row-${r.key}-local`}>
                            {formatCurrency(r.local!.planned, r.localCurrency!)} local planned
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.projects}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.planned)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.actual)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{money(r.expected)}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-black ${r.realisation < 50 ? "text-red-500" : r.realisation >= 100 ? "text-green-600" : ""}`}>{r.realisation}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
