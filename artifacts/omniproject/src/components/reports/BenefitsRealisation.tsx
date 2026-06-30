import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from "recharts";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { summariseBenefits, type BenefitBucket } from "../../lib/benefits";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";

/**
 * Benefits Realisation report. STATELESS: it rolls up the canonical `benefit*` fields already on
 * the project's work items — planned vs actual value, realisation %, the risk-adjusted forecast,
 * and the RAG spread — and derives everything on the fly. Nothing is stored.
 */

const BUCKET_META: Record<BenefitBucket, { label: string; colour: string }> = {
  realised: { label: "Realised", colour: "#16a34a" },
  on_track: { label: "On track", colour: "#2563eb" },
  at_risk: { label: "At risk", colour: "#d97706" },
  missed: { label: "Missed", colour: "#dc2626" },
  not_started: { label: "Not started", colour: "#6b7280" },
};
const BUCKET_ORDER: BenefitBucket[] = ["realised", "on_track", "at_risk", "missed", "not_started"];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border bg-background p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-black font-mono tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function BenefitsRealisation({ projectId }: { projectId: string }) {
  const { formatCurrency } = useT();
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });

  const ccy = useMemo(() => (issues ?? []).find((i) => i.currency)?.currency || "GBP", [issues]);
  const summary = useMemo(() => summariseBenefits((issues ?? []) as Issue[]), [issues]);
  const money = (n: number) => formatCurrency(n, ccy);

  const chartData = summary.rows.slice(0, 8).map((r) => ({
    name: r.title.length > 22 ? `${r.title.slice(0, 21)}…` : r.title,
    planned: r.planned,
    actual: r.actual,
  }));

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {summary.count === 0 ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="benefits-empty">
          No benefits to report — add planned/actual benefit values (and a benefit status) to work items to track realisation.
        </div>
      ) : (
        <div className="space-y-4" data-testid="benefits">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Planned benefit" value={money(summary.totalPlanned)} />
            <Kpi label="Realised to date" value={money(summary.totalActual)} hint={`${Math.round(summary.realisation * 100)}% of plan`} />
            <Kpi label="Realisation" value={`${Math.round(summary.realisation * 100)}%`} />
            <Kpi label="Risk-adjusted forecast" value={money(summary.expectedValue)} hint="planned × confidence" />
          </div>

          {/* RAG status spread */}
          <div className="flex flex-wrap gap-2" data-testid="benefits-rag">
            {BUCKET_ORDER.filter((b) => summary.byStatus[b] > 0).map((b) => (
              <span key={b} className="inline-flex items-center gap-2 border border-border px-2.5 py-1 text-xs font-bold">
                <span className="inline-block w-2.5 h-2.5" style={{ background: BUCKET_META[b].colour }} aria-hidden="true" />
                {BUCKET_META[b].label}
                <span className="tabular-nums text-muted-foreground">{summary.byStatus[b]}</span>
              </span>
            ))}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Planned vs realised (top benefits)</div>
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => money(v as number)} />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => money(v as number)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="planned" name="Planned" fill="#94a3b8" />
                <Bar dataKey="actual" name="Realised" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Benefit</th>
                  <th className="py-1.5 px-2 font-bold">Owner</th>
                  <th className="py-1.5 px-2 font-bold">Status</th>
                  <th className="py-1.5 px-2 font-bold text-right">Planned</th>
                  <th className="py-1.5 px-2 font-bold text-right">Realised</th>
                  <th className="py-1.5 px-2 font-bold text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50" data-testid={`benefit-row-${r.id}`}>
                    <td className="py-1.5 pr-3 font-mono truncate max-w-[16rem]">{r.title}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.benefitOwner || "—"}</td>
                    <td className="py-1.5 px-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2" style={{ background: BUCKET_META[r.bucket].colour }} aria-hidden="true" />
                        {BUCKET_META[r.bucket].label}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(r.planned)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{money(r.actual)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{Math.round(r.realisation * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Planned vs realised benefit value across {summary.count} tracked benefit(s). The
            risk-adjusted forecast weights each planned benefit by its confidence — nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
