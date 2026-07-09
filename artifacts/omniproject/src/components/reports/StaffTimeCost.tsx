import { useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useGetProjectIssues, getGetProjectIssuesQueryKey } from "@workspace/api-client-react";
import { useStaffCost } from "../../lib/rate-card";
import { firstCurrency } from "../../lib/currency";
import { truncateLabel } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Staff Time & Cost report. The roll-up is computed SERVER-SIDE (rates never reach the browser): the
 * gateway maps each assignee → hashed role → rate for the project's type and facing, then returns only
 * aggregated cost, the per-role breakdown (hashed labels), the PMO value columns, and the gross margin
 * on client-facing time. The currency is derived from the project's own work items, like the other
 * financial reports. Nothing is stored.
 */
export function StaffTimeCost({ projectId }: { projectId: string }) {
  const { formatCurrency } = useT();
  const { data, isLoading, isError, error, refetch } = useStaffCost(projectId);
  // Currency comes from the work items (the roll-up is currency-agnostic); falls back to the locale default.
  const { data: issues } = useGetProjectIssues(projectId, { query: { queryKey: getGetProjectIssuesQueryKey(projectId) } });
  const ccy = useMemo(() => firstCurrency(issues), [issues]);
  const money = useCallback((n: number) => formatCurrency(n, ccy), [formatCurrency, ccy]);

  const chart = useMemo(
    () => (data?.byTitle ?? []).slice(0, 8).map((r) => ({ name: truncateLabel(r.titleLabel), cost: r.cost, charge: r.charge })),
    [data],
  );
  const marginPct = data && data.clientCost > 0 ? Math.round((data.margin / data.clientCost) * 100) : 0;

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {!data || (data.totalCost === 0 && data.unratedHours === 0 && !data.timesheetActuals) ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="staff-cost-empty">
          No costable time — log hours against work items and map assignees to rated job titles (PMO rate card) to see staff time and cost.
        </div>
      ) : (
        <div className="space-y-4" data-testid="staff-time-cost">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="True cost" value={money(data.totalCost)} hint={`${money(data.clientCost)} client · ${money(data.internalCost)} internal`} />
            <StatCard label="Charge to customer" value={money(data.charge)} hint="client-facing time + overhead + margin" />
            <StatCard label="Gross margin" value={money(data.margin)} hint={`${marginPct}% of client-facing cost`} />
            <StatCard label="Unrated hours" value={data.unratedHours.toLocaleString()} hint={data.unratedHours > 0 ? "no rate mapped — excluded from cost" : "all time costed"} />
          </div>

          {data.columns.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="staff-cost-columns">
              {data.columns.map((c) => (
                <StatCard key={c.id} label={c.label} value={money(c.total)} hint={c.kind === "charge" ? "cost to customer" : "true cost"} />
              ))}
            </div>
          )}

          {data.timesheetActuals && (
            <div className="border border-border bg-muted/30 p-3 space-y-2" data-testid="timesheet-actuals">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Timesheet actuals — cost of approved time
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <StatCard label="Internal cost (approved)" value={money(data.timesheetActuals.internalCost)} hint="approved timesheet hours × rate card" />
                <StatCard label="Total cost (approved)" value={money(data.timesheetActuals.totalCost)} hint="all approved tracked time" />
                <StatCard label="Unrated (approved)" value={data.timesheetActuals.unratedHours.toLocaleString()} hint={data.timesheetActuals.unratedHours > 0 ? "no rate mapped — excluded" : "all approved time costed"} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Derived from <strong>approved</strong> timesheets below the seam, alongside the backend-logged cost above.
                Draft and submitted sheets are excluded.
              </p>
            </div>
          )}

          {chart.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Cost vs charge by role</div>
              <ResponsiveContainer width="100%" height={Math.max(160, chart.length * 38)}>
                <BarChart data={chart} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => money(v as number)} />
                  <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => money(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="cost" name="True cost" fill="#2563eb" />
                  <Bar dataKey="charge" name="Charge" fill="#16a34a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Role</th>
                  <th className="py-1.5 px-2 font-bold text-right">Hours</th>
                  <th className="py-1.5 px-2 font-bold text-right">True cost</th>
                  <th className="py-1.5 px-2 font-bold text-right">Charge</th>
                </tr>
              </thead>
              <tbody>
                {data.byTitle.map((r) => (
                  <tr key={r.titleHash} className="border-b border-border/50" data-testid={`staff-cost-row-${r.titleHash}`}>
                    <td className="py-1.5 pr-3 truncate max-w-[16rem]">{r.titleLabel}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.hours.toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(r.cost)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">{r.charge ? money(r.charge) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Rolled up across {data.byTitle.length} role(s){data.projectType ? ` for project type "${data.projectType}"` : ""}. Rates resolve
            server-side from the PMO rate card and never reach the browser.
            {data.appliedCostRules.length > 0 && ` Cost rules applied: ${data.appliedCostRules.join(", ")}.`}
          </p>
        </div>
      )}
    </DataState>
  );
}
