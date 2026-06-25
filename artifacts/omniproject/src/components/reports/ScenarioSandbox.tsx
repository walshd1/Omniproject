import { useMemo, useState } from "react";
import { useListProjects, useGetPortfolioHealth, useGetCapabilities } from "@workspace/api-client-react";
import { FlaskConical, RotateCcw, Camera } from "lucide-react";
import {
  applyScenario,
  summarize,
  diffSummary,
  type ScenarioAdjustments,
  type ScenarioSummary,
  type SummaryDiff,
} from "../../lib/scenario";
import { createSnapshot, addSnapshots, loadSnapshots } from "../../lib/snapshots";
import { useToast } from "@/hooks/use-toast";

/**
 * What-If scenario sandbox — a STATELESS, in-browser overlay on the LIVE
 * portfolio read-model. It forks `useListProjects` / `useGetPortfolioHealth`
 * into local React state, lets a planner nudge a few coarse levers per project,
 * and shows the aggregate baseline-vs-scenario delta. Nothing is written back to
 * any backend; "Capture as snapshot" simply persists the adjusted figures into
 * the existing (volatile, browser-only) snapshot store so a what-if can feed the
 * trend view. Discard = drop local state.
 */

const NUM = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtSigned = (n: number, unit = ""): string => `${n > 0 ? "+" : ""}${n}${unit}`;

function describeScenario(s: ScenarioSummary): string {
  return `${s.completionPct}% done · sched ${s.avgScheduleVarianceDays}d · budget ${s.avgBudgetVariancePct}% · ${s.totalBlockers} blockers`;
}

function KpiRow({ label, base, scenario, delta, unit }: {
  label: string;
  base: number;
  scenario: number;
  delta: number;
  unit?: string;
}) {
  const tone = delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-amber-500" : "text-green-500";
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-3 py-1.5 text-xs">
      <span className="font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <span className="font-mono text-muted-foreground" aria-label={`${label} baseline`}>{base}{unit}</span>
      <span className="font-mono font-bold" aria-label={`${label} scenario`}>{scenario}{unit}</span>
      <span className={`font-mono ${tone}`} aria-label={`${label} delta`}>{fmtSigned(delta, unit)}</span>
    </div>
  );
}

export function ScenarioSandbox() {
  const { data: projects } = useListProjects();
  const { data: portfolio } = useGetPortfolioHealth();
  const { data: caps } = useGetCapabilities();
  const { toast } = useToast();

  const [adjustments, setAdjustments] = useState<ScenarioAdjustments>({});

  const baseProjects = projects ?? [];
  const basePortfolio = portfolio ?? [];

  const adjusted = useMemo(
    () => applyScenario(baseProjects, basePortfolio, adjustments),
    [baseProjects, basePortfolio, adjustments],
  );

  const baseline: ScenarioSummary = useMemo(() => summarize(baseProjects, basePortfolio), [baseProjects, basePortfolio]);
  const scenario: ScenarioSummary = useMemo(() => summarize(adjusted.projects, adjusted.portfolio), [adjusted]);
  const delta: SummaryDiff = useMemo(() => diffSummary(baseline, scenario), [baseline, scenario]);

  const setLever = (projectId: string, key: keyof ScenarioAdjustments[string], value: number) => {
    setAdjustments((prev) => ({ ...prev, [projectId]: { ...prev[projectId], [key]: value } }));
  };

  const reset = () => setAdjustments({});

  const capture = () => {
    const snap = createSnapshot({
      projects: adjusted.projects,
      portfolio: adjusted.portfolio,
      mode: caps?.mode,
      label: `What-if: ${describeScenario(scenario)}`,
    });
    addSnapshots(loadSnapshots(), [snap]);
    toast({
      title: "SCENARIO CAPTURED",
      description: "Saved into this session's snapshots — nothing stored server-side.",
    });
  };

  const rows = basePortfolio.length
    ? basePortfolio.map((r) => ({
        projectId: r.projectId,
        name: r.projectName,
      }))
    : baseProjects.map((p) => ({ projectId: p.id, name: p.name }));

  return (
    <section data-testid="scenario-sandbox">
      <div className="flex items-center gap-3 mb-4">
        <FlaskConical className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-black uppercase tracking-widest text-muted-foreground">What-If Scenario Sandbox</h2>
      </div>

      <div className="bg-card border border-border p-4 space-y-5">
        {/* KPI panel: baseline vs scenario + delta */}
        <div data-testid="scenario-kpi" className="border border-border p-3">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 pb-2 mb-1 border-b border-border text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            <span>Metric</span>
            <span className="text-right">Baseline</span>
            <span className="text-right">Scenario</span>
            <span className="text-right">Δ</span>
          </div>
          <KpiRow label="Completion" base={baseline.completionPct} scenario={scenario.completionPct} delta={delta.completionPct} unit="%" />
          <KpiRow label="Avg schedule" base={baseline.avgScheduleVarianceDays} scenario={scenario.avgScheduleVarianceDays} delta={delta.avgScheduleVarianceDays} unit="d" />
          <KpiRow label="Avg budget" base={baseline.avgBudgetVariancePct} scenario={scenario.avgBudgetVariancePct} delta={delta.avgBudgetVariancePct} unit="%" />
          <KpiRow label="Blockers" base={baseline.totalBlockers} scenario={scenario.totalBlockers} delta={delta.totalBlockers} />
          <KpiRow label="RED projects" base={baseline.ragCounts.RED} scenario={scenario.ragCounts.RED} delta={delta.ragCounts.RED} />
        </div>

        {/* Per-project levers */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-black uppercase tracking-widest text-muted-foreground text-left">
                <th className="py-1 pr-3 font-black">Project</th>
                <th className="py-1 px-2 font-black">Completion Δ%</th>
                <th className="py-1 px-2 font-black">Schedule Δd</th>
                <th className="py-1 px-2 font-black">Budget Δ%</th>
                <th className="py-1 px-2 font-black">Blockers Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const adj = adjustments[row.projectId] ?? {};
                return (
                  <tr key={row.projectId} className="border-t border-border">
                    <td className="py-1.5 pr-3 font-bold truncate max-w-[12rem]">{row.name}</td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        aria-label={`Completion delta % for ${row.name}`}
                        value={adj.completionDeltaPct ?? 0}
                        onChange={(e) => setLever(row.projectId, "completionDeltaPct", NUM(e.target.value))}
                        className="w-20 px-2 py-1 bg-background border border-border font-mono outline-none focus:border-primary"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        aria-label={`Schedule delta days for ${row.name}`}
                        value={adj.scheduleDeltaDays ?? 0}
                        onChange={(e) => setLever(row.projectId, "scheduleDeltaDays", NUM(e.target.value))}
                        className="w-20 px-2 py-1 bg-background border border-border font-mono outline-none focus:border-primary"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        aria-label={`Budget delta % for ${row.name}`}
                        value={adj.budgetDeltaPct ?? 0}
                        onChange={(e) => setLever(row.projectId, "budgetDeltaPct", NUM(e.target.value))}
                        className="w-20 px-2 py-1 bg-background border border-border font-mono outline-none focus:border-primary"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        aria-label={`Blockers delta for ${row.name}`}
                        value={adj.blockersDelta ?? 0}
                        onChange={(e) => setLever(row.projectId, "blockersDelta", NUM(e.target.value))}
                        className="w-20 px-2 py-1 bg-background border border-border font-mono outline-none focus:border-primary"
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-muted-foreground">No portfolio data to model.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="scenario-reset"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button
            type="button"
            onClick={capture}
            className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="scenario-capture"
          >
            <Camera className="w-4 h-4" /> Capture as snapshot
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          This sandbox is <strong>volatile and in-browser</strong>: levers fork the live portfolio into local memory only.
          Nothing is written back to any backend — <strong>Reset</strong> or closing the tab discards it. <strong>Capture as snapshot</strong>{" "}
          saves the adjusted figures into this session's snapshot store (also browser-only) so a what-if can feed the trend view.
        </p>
      </div>
    </section>
  );
}
