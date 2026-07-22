import { useState } from "react";
import { ReportEmpty } from "./ReportEmpty";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ReportTable } from "./ReportTable";
import { SnapshotButton } from "./SnapshotControls";
import { useGetPortfolioFinancials, getGetPortfolioFinancialsQueryKey, useGetSettings } from "@workspace/api-client-react";
import { useFxRates } from "../../lib/currency";
import { currencyList } from "@workspace/backend-catalogue";

/** Human label for the org's FX as-of-date policy, for the footnote. */
const FX_POLICY_LABEL: Record<string, string> = {
  spot: "today's spot rate",
  periodClose: "the period-close rate",
  budgetRate: "the budget-set rate",
};

/**
 * Portfolio Financials (consolidated) — budget vs actual vs forecast across the whole portfolio, with
 * every project's local-currency figures converted into ONE reporting currency and rolled up by
 * programme. The consolidation now happens SERVER-SIDE (`GET /api/portfolio/financials?currency=`, the
 * shared consolidation engine), so this renderer is a thin view over one call — the reporting-currency
 * select re-requests the endpoint (the query key carries the `currency` param). STATELESS — read-through,
 * nothing stored.
 */

/** A programme/portfolio row's variance, coloured: projected overspend (negative) is the alarm. */
function VarianceCell({ v, money }: { v: number; money: (n: number) => string }) {
  const over = v < 0;
  return <span className={`tabular-nums font-black ${over ? "text-red-500" : "text-green-600"}`}>{over ? "" : "+"}{money(v)}</span>;
}

export function PortfolioFinancials() {
  const { formatCurrency } = useT();
  const [currency, setCurrency] = useState("");
  const params = currency ? { currency } : undefined;
  const { data, isLoading, isError, error, refetch } = useGetPortfolioFinancials(params, {
    query: { queryKey: getGetPortfolioFinancialsQueryKey(params), retry: false },
  });
  // FX rates (for the currency-picker option list) + settings (for the policy footnote) are cheap,
  // cached, read-through reads; the heavy per-project fan-out + FX consolidation is now the endpoint's.
  const { data: fx } = useFxRates();
  const { data: settings } = useGetSettings();
  const options = currencyList(fx?.rates);

  const target = data?.reportingCurrency ?? "";
  const money = (n: number) => formatCurrency(n, target);
  const hasData = !!data && data.portfolio.projects > 0;

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {!data || !hasData ? (
        <ReportEmpty testId="portfolio-fin-empty">
          No financials — connect a cost / ERP source so projects report budget, actual and forecast.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="portfolio-financials">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
              <StatCard label="Budget" value={money(data.portfolio.budget)} hint={`${data.portfolio.projects} project(s)`} />
              <StatCard label="Actual" value={money(data.portfolio.actual)} />
              <StatCard label="Forecast (EAC)" value={money(data.portfolio.forecast)} />
              <StatCard label="Variance" value={money(data.portfolio.variance)} hint={data.portfolio.variance < 0 ? "projected overspend" : "within budget"} />
            </div>
            <div className="flex items-center gap-3">
              {options.length > 0 && (
                <label className="text-xs flex items-center gap-1">
                  <span className="text-muted-foreground">Reporting currency</span>
                  <select aria-label="Reporting currency" className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs font-mono"
                    value={currency || target} onChange={(e) => setCurrency(e.target.value)}>
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
                  asOf: data.fx?.asOf ?? null,
                  fxProvenance: data.fx?.provenance ?? null,
                  portfolio: data.portfolio,
                  programmes: data.programmes,
                }}
              />
            </div>
          </div>

          <ReportTable
            rows={data.programmes}
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
            Consolidated from {data.currencyMix.length} currenc{data.currencyMix.length === 1 ? "y" : "ies"}
            {data.currencyMix.length > 1 ? ` (${data.currencyMix.map((c) => `${c.currency}×${c.projects}`).join(", ")})` : ""} into {target}
            {" "}at {FX_POLICY_LABEL[settings?.fxRatePolicy ?? "spot"] ?? "today's spot rate"}
            {data.fx?.provenance ? ` (FX ${data.fx.provenance}${data.fx.asOf ? ` as of ${new Date(data.fx.asOf).toLocaleDateString("en-GB", { timeZone: "UTC" })}` : ""})` : ""}.
            Variance = budget − forecast (EAC); CPI = earned value ÷ actual. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
