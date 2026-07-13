import { ReportEmpty } from "./ReportEmpty";
import { useMemo, useState } from "react";
import { useGetProjectIssues, getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import { simulate, mulberry32, type RiskTask } from "../../lib/monte-carlo";
import { isDone } from "../../lib/status-vocab";
import { DataState } from "../DataState";

/**
 * Monte Carlo schedule/effort-risk report (the "monteCarloRisk" feature module). STATELESS: it derives
 * a task list from the project's existing estimates and simulates the spread on the fly — nothing is
 * stored. Shows the S-curve (confidence vs effort), the key percentiles vs the naive plan, and a
 * tornado of the tasks driving the variance. A fixed seed keeps a given view reproducible.
 */

const ITERATION_OPTIONS = [1000, 2000, 5000, 10000];

function Pctl({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="border border-border bg-background p-3 text-center">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-2xl font-black font-mono tabular-nums">{value.toLocaleString()}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function MonteCarloRisk({ projectId }: { projectId: string }) {
  const { data: issues, isLoading, isError, error, refetch } = useGetProjectIssues(projectId, {
    query: { queryKey: getGetProjectIssuesQueryKey(projectId) },
  });
  const [uncertainty, setUncertainty] = useState(0.3);
  const [iterations, setIterations] = useState(2000);

  const tasks: RiskTask[] = useMemo(
    () => (issues ?? [])
      .filter((i: Issue) => (i.estimateHours ?? 0) > 0 && !isDone(i.status))
      .map((i: Issue) => ({ id: i.id, label: i.title, estimate: i.estimateHours as number })),
    [issues],
  );

  // Fixed seed ⇒ a given (tasks, uncertainty, iterations) renders the same curve every time.
  const result = useMemo(
    () => simulate(tasks, { uncertainty, iterations, rng: mulberry32(0x5eed) }),
    [tasks, uncertainty, iterations],
  );

  const tornado = result.sensitivity.slice(0, 8).map((s) => ({ ...s, value: Math.round(Math.abs(s.correlation) * 100) }));
  const planPct = Math.round(result.planConfidence * 100);

  return (
    <DataState isLoading={isLoading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {tasks.length === 0 ? (
        <ReportEmpty testId="mc-empty">
          No estimated, open work items to simulate — add effort estimates to quantify schedule risk.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="monte-carlo">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Uncertainty
              <input
                type="range" min={5} max={80} step={5}
                value={Math.round(uncertainty * 100)}
                onChange={(e) => setUncertainty(Number(e.target.value) / 100)}
                aria-label="Uncertainty percentage"
              />
              <span className="tabular-nums text-foreground">±{Math.round(uncertainty * 100)}%</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Iterations
              <select
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                aria-label="Iterations"
                className="h-8 rounded-none border border-border bg-background px-2 text-sm"
              >
                {ITERATION_OPTIONS.map((n) => <option key={n} value={n}>{n.toLocaleString()}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Pctl label="Plan (sum of estimates)" value={result.deterministic} hint={`${planPct}% confidence`} />
            <Pctl label="P50 (likely)" value={result.p50} />
            <Pctl label="P80 (commit)" value={result.p80} />
            <Pctl label="P90 (safe)" value={result.p90} />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Confidence S-curve (effort hrs)</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={result.curve} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="value" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, 1]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${Math.round(Number(v) * 100)}% chance ≤`} labelFormatter={(l) => `${Number(l).toLocaleString()} hrs`} />
                <ReferenceLine x={result.deterministic} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "plan", fontSize: 10, fill: "#dc2626" }} />
                <ReferenceLine x={result.p80} stroke="#16a34a" strokeDasharray="4 2" label={{ value: "P80", fontSize: 10, fill: "#16a34a" }} />
                <Area type="monotone" dataKey="probability" stroke="#2563eb" fill="#2563eb" fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Variance drivers (tornado)</div>
            <ResponsiveContainer width="100%" height={Math.max(120, tornado.length * 26)}>
              <BarChart data={tornado} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v) => `${Number(v)}% of variance`} />
                <Bar dataKey="value">
                  {tornado.map((tk) => <Cell key={tk.id} fill="#d97706" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {result.iterations.toLocaleString()} simulations. The plan (sum of estimates) carries only
            {" "}<strong className="text-foreground">{planPct}%</strong> confidence — commit to the
            {" "}<strong className="text-foreground">P80</strong> for a defensible target.
          </p>
        </div>
      )}
    </DataState>
  );
}
