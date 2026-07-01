import { useMemo, useState } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { useGetProjectFinancials, useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import {
  timePhasedForecast, scheduleWindow, SPREAD_PROFILES, type SpreadProfile,
} from "../../lib/forecast-curve";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";

/**
 * Forecasting windows — the time-phased budget S-curve a head of projects needs alongside the
 * point-in-time EVM scalars: planned value spread across the schedule, actuals to today, and the
 * forecast-to-go climbing to EAC. Fully DERIVED from BAC/AC/EAC + the work-item date window + a
 * chosen spreading profile; nothing is stored. STATELESS.
 */
export function ForecastWindows({ projectId, now }: { projectId: string; now?: number }) {
  const { formatCurrency } = useT();
  const fin = useGetProjectFinancials(projectId);
  const iss = useGetProjectIssues(projectId, { query: { queryKey: getGetProjectIssuesQueryKey(projectId) } });
  const [profile, setProfile] = useState<SpreadProfile>("scurve");

  const f = fin.data;
  const asOf = now ?? Date.now();
  const ccy = f?.currency || "GBP";
  const money = (n: number) => formatCurrency(n, ccy);

  const curve = useMemo(() => {
    if (!f || f.budgetAllocated == null) return null;
    const window = scheduleWindow((iss.data ?? []) as Issue[], asOf);
    if (!window) return null;
    return timePhasedForecast({
      bac: f.budgetAllocated,
      eac: f.forecastCostAtCompletion ?? f.budgetAllocated,
      actualToDate: f.actualBurn ?? 0,
      start: window.start,
      end: window.end,
      asOf,
      profile,
    });
  }, [f, iss.data, asOf, profile]);

  const loading = fin.isLoading || iss.isLoading;
  const isError = fin.isError || iss.isError;
  const chartData = (curve?.periods ?? []).map((p) => ({ label: p.label, Planned: Math.round(p.planned), Actual: p.actual == null ? null : Math.round(p.actual), Forecast: p.forecast == null ? null : Math.round(p.forecast) }));
  const nowLabel = curve && curve.nowIndex >= 0 ? curve.periods[curve.nowIndex]!.label : null;

  return (
    <DataState isLoading={loading} isError={isError} error={fin.error || iss.error} onRetry={() => { void fin.refetch(); void iss.refetch(); }} className="min-h-40">
      {!curve ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="forecast-empty">
          No time-phased forecast — needs a budget from a cost / ERP source and start / due dates on work items to spread it across.
        </div>
      ) : (
        <div className="space-y-4" data-testid="forecast-windows">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
              <StatCard label="Budget (BAC)" value={money(curve.bac)} />
              <StatCard label="Spent to date" value={money(curve.actualToDate)} hint={`planned ${money(curve.plannedToDate)} by now`} />
              <StatCard label="Forecast (EAC)" value={money(curve.eac)} />
              <StatCard label="Variance (VAC)" value={money(curve.vac)} hint={curve.vac < 0 ? "projected overspend" : "within budget"} />
            </div>
            <label className="text-xs flex items-center gap-1">
              <span className="text-muted-foreground">Spread</span>
              <select aria-label="Spreading profile" className="rounded-none border-2 border-foreground bg-background px-2 py-1 text-xs font-mono"
                value={profile} onChange={(e) => setProfile(e.target.value as SpreadProfile)}>
                {SPREAD_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" />
                <XAxis dataKey="label" stroke="currentColor" className="text-muted-foreground" fontSize={11} />
                <YAxis stroke="currentColor" className="text-muted-foreground" fontSize={11} tickFormatter={(v) => money(v as number)} width={84} />
                <Tooltip formatter={(v) => money(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <ReferenceLine y={curve.bac} stroke="#a1a1aa" strokeDasharray="4 4" />
                {nowLabel && <ReferenceLine x={nowLabel} stroke="#6366f1" strokeDasharray="2 2" label={{ value: "now", fontSize: 10, fill: "#6366f1" }} />}
                <Area type="monotone" dataKey="Planned" stroke="#a1a1aa" fill="#a1a1aa" fillOpacity={0.12} strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Actual" stroke="#22c55e" strokeWidth={2.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="Forecast" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Planned value spread as a <span className="font-mono">{SPREAD_PROFILES.find((p) => p.id === profile)?.label}</span> curve
            across the schedule window; actuals anchored to AC up to {nowLabel ?? "now"}, forecast-to-go climbing to EAC.
            Derived live from point-in-time financials + work-item dates — indicative, nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
