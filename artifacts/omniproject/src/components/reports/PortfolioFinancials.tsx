import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useListProjects, useGetSettings, getGetProjectFinancialsQueryOptions, type ProjectFinancials } from "@workspace/api-client-react";
import { useFxRates, currencyList } from "../../lib/currency";
import { consolidateFinancials, type ProjectFin, type FinanceRollup } from "../../lib/portfolio-finance";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { SnapshotButton } from "./SnapshotControls";

/**
 * Portfolio Financials (consolidated) — budget vs actual vs forecast across the whole portfolio, with
 * every project's local-currency figures converted into ONE reporting currency via the broker's FX
 * table. Rolled up by programme. The board-level view a head of projects can't assemble by hand at
 * multi-country scale. STATELESS — financials + FX are read through, nothing is stored.
 */

/** A programme/portfolio row's variance, coloured: projected overspend (negative) is the alarm. */
function VarianceCell({ v, money }: { v: number; money: (n: number) => string }) {
  const over = v < 0;
  return <span className={`tabular-nums font-black ${over ? "text-red-500" : "text-green-600"}`}>{over ? "" : "+"}{money(v)}</span>;
}

function Row({ r, money }: { r: FinanceRollup; money: (n: number) => string }) {
  return (
    <tr className="border-b border-border/50" data-testid={`portfolio-fin-row-${r.key}`}>
      <td className="py-2 pr-3 font-bold">{r.label}</td>
      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.projects}</td>
      <td className="py-2 px-2 text-right tabular-nums">{money(r.budget)}</td>
      <td className="py-2 px-2 text-right tabular-nums">{money(r.actual)}</td>
      <td className="py-2 px-2 text-right tabular-nums">{money(r.forecast)}</td>
      <td className="py-2 px-2 text-right"><VarianceCell v={r.variance} money={money} /></td>
      <td className="py-2 px-2 text-right tabular-nums">{r.cpi === null ? "—" : r.cpi.toFixed(2)}</td>
    </tr>
  );
}

export function PortfolioFinancials() {
  const { formatCurrency } = useT();
  const { data: projects, isLoading: projLoading, isError, error, refetch } = useListProjects();
  const { data: fx } = useFxRates();
  const { data: settings } = useGetSettings();
  const [reporting, setReporting] = useState<string>("");

  const ids = useMemo(() => (projects ?? []).map((p) => p.id), [projects]);
  const finQueries = useQueries({ queries: ids.map((id) => getGetProjectFinancialsQueryOptions(id)) });

  // View override → the org default reporting currency → the FX base.
  const target = reporting || settings?.reportingCurrency || fx?.base || "GBP";
  const loading = projLoading || finQueries.some((q) => q.isLoading);

  const consolidated = useMemo(() => {
    const withFin: ProjectFin[] = (projects ?? [])
      .map((p, i) => ({ p, fin: finQueries[i]?.data as ProjectFinancials | undefined }))
      .filter((x): x is { p: typeof x.p; fin: ProjectFinancials } => !!x.fin)
      .map(({ p, fin }) => ({ projectId: p.id, projectName: p.name, programmeId: p.programmeId ?? null, programmeName: p.programmeName ?? null, fin }));
    return consolidateFinancials(withFin, target, fx?.rates);
  }, [projects, finQueries, target, fx]);

  const money = (n: number) => formatCurrency(n, target);
  const options = currencyList(fx?.rates);
  const hasData = consolidated.portfolio.projects > 0;

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {!hasData ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="portfolio-fin-empty">
          No financials — connect a cost / ERP source so projects report budget, actual and forecast.
        </div>
      ) : (
        <div className="space-y-4" data-testid="portfolio-financials">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
              <StatCard label="Budget" value={money(consolidated.portfolio.budget)} hint={`${consolidated.portfolio.projects} project(s)`} />
              <StatCard label="Actual" value={money(consolidated.portfolio.actual)} />
              <StatCard label="Forecast (EAC)" value={money(consolidated.portfolio.forecast)} />
              <StatCard label="Variance" value={money(consolidated.portfolio.variance)} hint={consolidated.portfolio.variance < 0 ? "projected overspend" : "within budget"} />
            </div>
            <div className="flex items-center gap-3">
              {options.length > 0 && (
                <label className="text-xs flex items-center gap-1">
                  <span className="text-muted-foreground">Reporting currency</span>
                  <select aria-label="Reporting currency" className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs font-mono"
                    value={target} onChange={(e) => setReporting(e.target.value)}>
                    {options.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              <SnapshotButton
                scope="portfolio-financials"
                label={`Portfolio financials (${target})`}
                data={{ reportingCurrency: target, asOf: fx?.asOf ?? null, fxProvenance: fx?.provenance ?? null, portfolio: consolidated.portfolio, programmes: consolidated.programmes }}
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Projects</th>
                  <th className="py-1.5 px-2 font-bold text-right">Budget</th>
                  <th className="py-1.5 px-2 font-bold text-right">Actual</th>
                  <th className="py-1.5 px-2 font-bold text-right">Forecast</th>
                  <th className="py-1.5 px-2 font-bold text-right">Variance</th>
                  <th className="py-1.5 px-2 font-bold text-right">CPI</th>
                </tr>
              </thead>
              <tbody>
                {consolidated.programmes.map((r) => <Row key={r.key} r={r} money={money} />)}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Consolidated from {consolidated.currencyMix.length} currenc{consolidated.currencyMix.length === 1 ? "y" : "ies"}
            {consolidated.currencyMix.length > 1 ? ` (${consolidated.currencyMix.map((c) => `${c.currency}×${c.projects}`).join(", ")})` : ""} into {target}
            {fx?.provenance ? ` · FX ${fx.provenance}${fx.asOf ? ` as of ${new Date(fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""}` : ""}.
            Variance = budget − forecast (EAC); CPI = earned value ÷ actual. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
