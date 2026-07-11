import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  realisationPipeline, realisationSchedule, BUCKET_LABEL, type BucketValue,
} from "../../lib/benefits-realisation";
import type { BenefitBucket } from "../../lib/benefits";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { SnapshotButton } from "./SnapshotControls";
import { usePortfolioItems } from "./use-portfolio-items";
import { chartTooltipStyle, gridTheme, axisTheme } from "./chart-theme";

/**
 * Portfolio Benefits Realisation roll-up — the realisation lens on top of the planned-vs-realised table:
 * the benefit pipeline by lifecycle stage measured in VALUE, and the realisation trajectory over time
 * (planned benefit value by due date vs realised to date). Answers "are we on track to realise the value
 * we committed, and by when?" at portfolio scale. STATELESS — derived live, nothing stored.
 */

const BUCKET_COLOR: Record<BenefitBucket, string> = {
  realised: "text-green-600", on_track: "text-green-500", at_risk: "text-amber-500", missed: "text-red-500", not_started: "text-muted-foreground",
};
const BUCKET_BAR: Record<BenefitBucket, string> = {
  realised: "bg-green-600", on_track: "bg-green-500", at_risk: "bg-amber-500", missed: "bg-red-500", not_started: "bg-muted-foreground/40",
};

function PipelineRow({ b, total, money }: { b: BucketValue; total: number; money: (n: number) => string }) {
  const share = total > 0 ? (b.planned / total) * 100 : 0;
  return (
    <div className="grid grid-cols-[9rem_1fr_auto] items-center gap-3" data-testid={`benefit-bucket-${b.bucket}`}>
      <span className={`text-xs font-black uppercase tracking-widest ${BUCKET_COLOR[b.bucket]}`}>{BUCKET_LABEL[b.bucket]}</span>
      <span className="h-2.5 bg-border/40 overflow-hidden"><span className={`block h-full ${BUCKET_BAR[b.bucket]}`} style={{ width: `${share}%` }} /></span>
      <span className="text-xs tabular-nums text-right text-muted-foreground">{money(b.planned)} · {b.count}</span>
    </div>
  );
}

export function BenefitsRealisationRollup({ now }: { now?: number }) {
  const { formatCurrency } = useT();
  const { projects, loading, isError, error, refetch, target, rates } = usePortfolioItems();
  const asOf = now ?? Date.now();

  const pipeline = useMemo(() => realisationPipeline(projects, target, rates), [projects, target, rates]);
  const schedule = useMemo(() => realisationSchedule(projects, target, rates, asOf), [projects, target, rates, asOf]);
  const money = (n: number) => formatCurrency(n, target);

  const chartData = schedule.periods.map((p) => ({
    label: p.label,
    Planned: Math.round(p.cumulativePlanned),
    Realised: p.cumulativeRealised == null ? null : Math.round(p.cumulativeRealised),
  }));
  const nowLabel = schedule.periods.find((p) => {
    const next = schedule.periods[schedule.periods.indexOf(p) + 1];
    return p.start <= asOf && (!next || next.start > asOf);
  })?.label ?? null;

  const snapshotData = { asOf: schedule.periods.length ? asOf : null, reportingCurrency: target, pipeline, schedule };

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {pipeline.totalPlanned === 0 && pipeline.totalActual === 0 ? (
        <ReportEmpty testId="benefits-realisation-empty">
          No benefits data — set planned/actual benefit values, a status and a due date on work items to track realisation over time.
        </ReportEmpty>
      ) : (
        <div className="space-y-5" data-testid="benefits-realisation">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
              <StatCard label="Planned benefit" value={money(pipeline.totalPlanned)} hint={`${projects.length} project(s)`} />
              <StatCard label="Realised" value={money(pipeline.totalActual)} hint={`${pipeline.realisationPct}% of plan`} />
              <StatCard label="At risk / missed" value={money(pipeline.atRiskValue)} hint="planned value in jeopardy" />
              <StatCard label="Shortfall to date" value={money(schedule.shortfallToDate)} hint={schedule.shortfallToDate > 0 ? "behind plan" : "on plan"} />
            </div>
            <SnapshotButton scope="benefits-realisation" label={`Benefits realisation (${target})`} data={snapshotData} />
          </div>

          <div>
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Realisation pipeline (by planned value)</h3>
            <div className="space-y-1.5">
              {pipeline.buckets.map((b) => <PipelineRow key={b.bucket} b={b} total={pipeline.totalPlanned} money={money} />)}
            </div>
          </div>

          {schedule.periods.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Realisation trajectory (by benefit due date)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                    <CartesianGrid {...gridTheme} />
                    <XAxis dataKey="label" {...axisTheme} fontSize={11} />
                    <YAxis {...axisTheme} fontSize={11} tickFormatter={(v) => money(v as number)} width={84} />
                    <Tooltip formatter={(v) => money(v as number)} contentStyle={chartTooltipStyle} />
                    <Legend />
                    {nowLabel && <ReferenceLine x={nowLabel} stroke="#6366f1" strokeDasharray="2 2" label={{ value: "now", fontSize: 10, fill: "#6366f1" }} />}
                    <Area type="monotone" dataKey="Planned" stroke="#a1a1aa" fill="#a1a1aa" fillOpacity={0.12} strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="Realised" stroke="#22c55e" strokeWidth={2.5} dot={false} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Planned benefit value bucketed by lifecycle status and by due quarter, consolidated into {target}; realised value shown to today.
            {schedule.overdueUnrealised > 0 ? ` ${money(schedule.overdueUnrealised)} of overdue benefit is not yet realised.` : ""}
            {schedule.undated > 0 ? ` ${money(schedule.undated)} of planned benefit carries no due date (excluded from the trajectory).` : ""}
            {" "}Snapshot to freeze a signed board pack. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
