import { ReportEmpty } from "./ReportEmpty";
import { useCallback, useMemo } from "react";
import { ChartView } from "../charts/ChartView";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { summariseFinancials } from "../../lib/financial-summary";
import { useProjectIssuesMoney } from "../../lib/currency";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Financial summary — budget vs actual vs variance, rolled up from the work items the backend carries
 * (the `financial` field group). Derive-only; OmniProject stores nothing.
 */
export function FinancialSummary({ projectId }: { projectId: string }) {
  const { issues, ccy, money, isLoading, isError, error, refetch } = useProjectIssuesMoney(projectId);

  const summary = useMemo(() => summariseFinancials((issues ?? []) as Issue[]), [issues]);
  const chart = useMemo(
    () => [{ name: "Budget", value: summary.budget }, { name: "Actual", value: summary.actual }],
    [summary],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.costedItems === 0 ? (
        <ReportEmpty testId="financial-summary-empty">
          No financial data — set a budget and actual cost on work items to see the financial summary.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="financial-summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Budget" value={money(summary.budget)} />
            <StatCard label="Actual" value={money(summary.actual)} hint={`${summary.pctConsumed}% consumed`} />
            <StatCard label="Variance" value={money(summary.variance)} hint={summary.variance >= 0 ? "under budget" : "over budget"} />
            <StatCard label="Costed items" value={String(summary.costedItems)} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Budget vs actual</div>
            <ChartView type="bar" orientation="vertical" height={180} legend={false} data={chart} series={[{ key: "value", label: "Amount" }]} valueFormatter={money} />
          </div>
        </div>
      )}
    </DataState>
  );
}
