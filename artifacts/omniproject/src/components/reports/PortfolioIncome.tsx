import { useMemo } from "react";
import { rollupIncome } from "../../lib/portfolio-value";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
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
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="portfolio-income-empty">
          No income data — set projected income (revenue) and invoiced amounts on work items to track billing across the portfolio.
        </div>
      ) : (
        <div className="space-y-4" data-testid="portfolio-income">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projected income" value={money(portfolio.projected)} hint={`${portfolio.projects} project(s)`} />
            <StatCard label="Invoiced" value={money(portfolio.invoiced)} hint={`${portfolio.billedPct}% billed`} />
            <StatCard label="Unbilled" value={money(portfolio.unbilled)} hint="projected − invoiced" />
            <StatCard label="Billed" value={`${portfolio.billedPct}%`} hint={portfolio.billedPct >= 100 ? "fully invoiced" : "billing outstanding"} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projects</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projected</th>
                  <th className="py-1.5 px-2 font-bold text-right">Invoiced</th>
                  <th className="py-1.5 px-2 font-bold text-right">Unbilled</th>
                  <th className="py-1.5 px-2 font-bold text-right">Billed</th>
                </tr>
              </thead>
              <tbody>
                {programmes.map((r) => {
                  const showLocal = !!r.localCurrency && r.localCurrency !== target && !!r.local;
                  return (
                    <tr key={r.key} className="border-b border-border/50" data-testid={`portfolio-income-row-${r.key}`}>
                      <td className="py-2 pr-3 font-bold">
                        {r.label}
                        {showLocal && (
                          <div className="text-[10px] font-normal text-muted-foreground" data-testid={`portfolio-income-row-${r.key}-local`}>
                            {formatCurrency(r.local!.projected, r.localCurrency!)} local projected
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.projects}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.projected)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(r.invoiced)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-amber-600">{r.unbilled ? money(r.unbilled) : "—"}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{r.billedPct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
