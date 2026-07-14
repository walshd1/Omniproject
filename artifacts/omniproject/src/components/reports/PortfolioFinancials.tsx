import { ReportEmpty } from "./ReportEmpty";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable } from "./ReportTable";
import { SnapshotButton } from "./SnapshotControls";
import { usePortfolioFinancials } from "./use-portfolio-financials";

/** Human label for the org's FX as-of-date policy, for the footnote. */
const FX_POLICY_LABEL: Record<string, string> = {
  spot: "today's spot rate",
  periodClose: "the period-close rate",
  budgetRate: "the budget-set rate",
};

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

export function PortfolioFinancials() {
  const { formatCurrency } = useT();
  const { consolidated, target, setReporting, options, projLoading, finLoading, isError, error, refetch, settings, fx } = usePortfolioFinancials();

  const loading = projLoading || finLoading;

  const money = (n: number) => formatCurrency(n, target);
  const hasData = consolidated.portfolio.projects > 0;

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {!hasData ? (
        <ReportEmpty testId="portfolio-fin-empty">
          No financials — connect a cost / ERP source so projects report budget, actual and forecast.
        </ReportEmpty>
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
                data={{
                  reportingCurrency: target,
                  fxRatePolicy: settings?.fxRatePolicy ?? "spot",
                  asOf: fx?.asOf ?? null,
                  fxProvenance: fx?.provenance ?? null,
                  portfolio: consolidated.portfolio,
                  programmes: consolidated.programmes,
                }}
              />
            </div>
          </div>

          <ReportTable
            rows={consolidated.programmes}
            rowKey={(r) => r.key}
            rowTestId={(r) => `portfolio-fin-row-${r.key}`}
            size="comfortable"
            columns={[
              {
                header: "Programme",
                cellClassName: "font-bold",
                // A row still in its own single currency (most Standalone rows; a single-country programme)
                // shows that local figure alongside the consolidated total — dropped once a row mixes ≥2.
                cell: (r) => {
                  const showLocal = !!r.localCurrency && r.localCurrency !== target && !!r.local;
                  return (
                    <>
                      {r.label}
                      {showLocal && (
                        <div className="text-[10px] font-normal text-muted-foreground" data-testid={`portfolio-fin-row-${r.key}-local`}>
                          {formatCurrency(r.local!.budget, r.localCurrency!)} local budget
                        </div>
                      )}
                    </>
                  );
                },
              },
              { header: "Projects", align: "right", cell: (r) => r.projects, cellClassName: "text-muted-foreground" },
              { header: "Budget", align: "right", cell: (r) => money(r.budget) },
              { header: "Actual", align: "right", cell: (r) => money(r.actual) },
              { header: "Forecast", align: "right", cell: (r) => money(r.forecast) },
              { header: "Variance", headerClassName: "text-right", cellClassName: "text-right", cell: (r) => <VarianceCell v={r.variance} money={money} /> },
              { header: "CPI", align: "right", cell: (r) => (r.cpi === null ? "—" : r.cpi.toFixed(2)) },
            ]}
          />

          <p className="text-[11px] text-muted-foreground">
            Consolidated from {consolidated.currencyMix.length} currenc{consolidated.currencyMix.length === 1 ? "y" : "ies"}
            {consolidated.currencyMix.length > 1 ? ` (${consolidated.currencyMix.map((c) => `${c.currency}×${c.projects}`).join(", ")})` : ""} into {target}
            {" "}at {FX_POLICY_LABEL[settings?.fxRatePolicy ?? "spot"] ?? "today's spot rate"}
            {fx?.provenance ? ` (FX ${fx.provenance}${fx.asOf ? ` as of ${new Date(fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""})` : ""}.
            Variance = budget − forecast (EAC); CPI = earned value ÷ actual. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
