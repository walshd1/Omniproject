import { useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { summariseFinancials } from "../../lib/financial-summary";
import { firstCurrency } from "../../lib/currency";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Financial summary — budget vs actual vs variance, rolled up from the work items the backend carries
 * (the `financial` field group). Derive-only; OmniProject stores nothing.
 */
export function FinancialSummary({ projectId }: { projectId: string }) {
  const { formatCurrency } = useT();
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });

  const ccy = useMemo(() => firstCurrency(issues), [issues]);
  const summary = useMemo(() => summariseFinancials((issues ?? []) as Issue[]), [issues]);
  const money = useCallback((n: number) => formatCurrency(n, ccy), [formatCurrency, ccy]);
  const chart = useMemo(
    () => [{ name: "Budget", value: summary.budget }, { name: "Actual", value: summary.actual }],
    [summary],
  );

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.costedItems === 0 ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="financial-summary-empty">
          No financial data — set a budget and actual cost on work items to see the financial summary.
        </div>
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
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chart} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => money(v as number)} width={70} />
                <Tooltip formatter={(v) => money(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Bar dataKey="value" name="Amount" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </DataState>
  );
}
