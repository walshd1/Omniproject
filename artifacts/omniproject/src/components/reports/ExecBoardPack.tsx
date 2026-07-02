import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useListProjects, useGetSettings, useGetPortfolioHealth,
  getGetProjectFinancialsQueryOptions, type ProjectFinancials,
} from "@workspace/api-client-react";
import { componentsFor } from "@workspace/backend-catalogue";
import { useFxRates, resolveFxAsOf, currencyList } from "../../lib/currency";
import { consolidateFinancials, type ProjectFin } from "../../lib/portfolio-finance";
import { buildExecHealth, execHeadline, type ExecException, type Rag } from "../../lib/exec-pack";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { SnapshotButton } from "./SnapshotControls";
import { LibraryComponentView } from "../library/LibraryComponentView";
import { resolveLibraryComponent } from "../../lib/component-library";

/**
 * Executive / board reporting pack — one consolidated, board-ready view across the whole portfolio:
 * the headline narrative, the RAG spread, the consolidated financials (in one reporting currency), and
 * the exceptions that need a board decision. Composes the existing portfolio-health + financial roll-ups;
 * snapshot-able so a dated, signed board pack can be frozen. STATELESS — derived live, nothing stored.
 *
 * Beyond the fixed sections, the board pack can be extended with ANY component from the unified
 * library's "export" surface (componentsFor("export") — every report + widget) — picked ad hoc per
 * session, not a hardcoded set. The picker only offers components that resolve to a real inline
 * renderer (skips surfaced-via reports, which have nowhere to render here).
 */

const RAG_STYLE: Record<Rag, { dot: string; text: string }> = {
  GREEN: { dot: "bg-green-500", text: "text-green-600" },
  AMBER: { dot: "bg-amber-500", text: "text-amber-500" },
  RED: { dot: "bg-red-500", text: "text-red-500" },
};

function RagBar({ rag, total }: { rag: Record<Rag, number>; total: number }) {
  const seg = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className="flex h-3 w-full overflow-hidden border border-border" role="img" aria-label={`${rag.GREEN} green, ${rag.AMBER} amber, ${rag.RED} red`}>
      <div className="bg-green-500" style={{ width: seg(rag.GREEN) }} />
      <div className="bg-amber-500" style={{ width: seg(rag.AMBER) }} />
      <div className="bg-red-500" style={{ width: seg(rag.RED) }} />
    </div>
  );
}

function ExceptionRow({ e }: { e: ExceptionView }) {
  const style = RAG_STYLE[e.rag];
  return (
    <tr className="border-b border-border/50" data-testid={`exec-exception-${e.projectId}`}>
      <td className="py-2 pr-3">
        <span className={`inline-flex items-center gap-1.5 font-black uppercase text-[10px] tracking-widest ${style.text}`}>
          <span className={`w-2 h-2 rounded-full ${style.dot}`} />{e.rag}
        </span>
      </td>
      <td className="py-2 pr-3 font-bold">{e.projectName}</td>
      <td className={`py-2 px-2 text-right tabular-nums ${e.scheduleVarianceDays < 0 ? "text-red-500" : ""}`}>
        {e.scheduleVarianceDays > 0 ? "+" : ""}{e.scheduleVarianceDays}d
      </td>
      <td className={`py-2 px-2 text-right tabular-nums ${e.budgetVariancePercentage > 0 ? "text-red-500" : "text-green-600"}`}>
        {e.budgetVariancePercentage > 0 ? "+" : ""}{e.budgetVariancePercentage}%
      </td>
      <td className={`py-2 px-2 text-right tabular-nums ${e.activeBlockersCount > 0 ? "text-amber-500" : "text-muted-foreground"}`}>{e.activeBlockersCount}</td>
    </tr>
  );
}

type ExceptionView = ExecException;

export function ExecBoardPack() {
  const { formatCurrency } = useT();
  const { data: projects, isLoading: projLoading, isError: projErr, error: projError, refetch } = useListProjects();
  const health = useGetPortfolioHealth();
  const { data: settings } = useGetSettings();
  const { data: fx } = useFxRates(resolveFxAsOf(settings));
  const [reporting, setReporting] = useState("");
  // Extra library components chosen for THIS board pack, on top of the fixed sections below —
  // componentsFor("export") is the same unified library the Reports page + dashboards draw from.
  // Only offer components with a real inline renderer (a surfaced-via report has nowhere to render).
  const extraCatalogue = useMemo(() => componentsFor("export").filter((c) => resolveLibraryComponent(c)), []);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const extras = extraCatalogue.filter((c) => extraIds.includes(c.id));

  const ids = useMemo(() => (projects ?? []).map((p) => p.id), [projects]);
  // `combine` keeps the per-project financials array referentially stable across renders that
  // don't change the underlying query data, so `financials` below doesn't re-run
  // consolidateFinancials over the whole portfolio on every unrelated re-render. See
  // docs/PERF-PATTERNS-REVIEW.md, Theme C.
  const financialsByProject = useQueries({
    queries: ids.map((id) => getGetProjectFinancialsQueryOptions(id)),
    combine: (results) => results.map((r) => r.data as ProjectFinancials | undefined),
  });

  const target = reporting || settings?.reportingCurrency || fx?.base || "GBP";
  // Health is the spine; financials are an optional overlay, so don't block the pack on the finance fan-out.
  const loading = projLoading || health.isLoading;

  const execHealth = useMemo(() => buildExecHealth(health.data ?? []), [health.data]);
  const financials = useMemo(() => {
    const withFin: ProjectFin[] = (projects ?? [])
      .map((p, i) => ({ p, fin: financialsByProject[i] }))
      .filter((x): x is { p: typeof x.p; fin: ProjectFinancials } => !!x.fin)
      .map(({ p, fin }) => ({ projectId: p.id, projectName: p.name, programmeId: p.programmeId ?? null, programmeName: p.programmeName ?? null, fin }));
    return consolidateFinancials(withFin, target, fx?.rates);
  }, [projects, financialsByProject, target, fx]);

  const money = (n: number) => formatCurrency(n, target);
  const options = currencyList(fx?.rates);
  const programmeCount = new Set((projects ?? []).map((p) => p.programmeId ?? p.id)).size;
  const hasData = execHealth.total > 0;
  const fin = financials.portfolio;
  const hasFinancials = fin.projects > 0;

  const snapshotData = {
    asOf: fx?.asOf ?? null, reportingCurrency: target, fxRatePolicy: settings?.fxRatePolicy ?? "spot",
    health: { rag: execHealth.rag, atRiskPct: execHealth.atRiskPct, totalBlockers: execHealth.totalBlockers, worstSlipDays: execHealth.worstSlipDays },
    financials: hasFinancials ? { budget: fin.budget, actual: fin.actual, forecast: fin.forecast, variance: fin.variance } : null,
    exceptions: execHealth.exceptions,
    // Which extra library components were chosen for THIS pack (id + label only — their own figures
    // aren't reduced to JSON here; they render live below and are captured by their own export path).
    extraComponents: extras.map((c) => ({ id: c.id, label: c.label })),
  };

  return (
    <DataState isLoading={loading} isError={projErr || health.isError} error={projError || health.error} onRetry={() => { void refetch(); void health.refetch(); }} className="min-h-40">
      {!hasData ? (
        <div className="bg-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="exec-pack-empty">
          No portfolio data — connect a backend so projects report RAG status, schedule and budget variance.
        </div>
      ) : (
        <div className="space-y-5" data-testid="exec-board-pack">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm font-bold max-w-2xl" data-testid="exec-headline">{execHeadline(execHealth)}</p>
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
              <SnapshotButton scope="exec-board-pack" label={`Board pack (${target})`} data={snapshotData} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projects" value={String(execHealth.total)} hint={`${programmeCount} programme(s)`} />
            <StatCard label="On track" value={String(execHealth.rag.GREEN)} hint={`${Math.round((1 - execHealth.atRiskPct) * 100)}% of portfolio`} />
            <StatCard label="Need attention" value={String(execHealth.rag.AMBER + execHealth.rag.RED)} hint={`${execHealth.rag.RED} red · ${execHealth.rag.AMBER} amber`} />
            <StatCard label="Active blockers" value={String(execHealth.totalBlockers)} hint={execHealth.worstSlipDays < 0 ? `worst slip ${execHealth.worstSlipDays}d` : "no slip"} />
          </div>

          <div className="space-y-1">
            <RagBar rag={execHealth.rag} total={execHealth.total} />
            <div className="flex gap-4 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span><span className="text-green-600 font-black">{execHealth.rag.GREEN}</span> green</span>
              <span><span className="text-amber-500 font-black">{execHealth.rag.AMBER}</span> amber</span>
              <span><span className="text-red-500 font-black">{execHealth.rag.RED}</span> red</span>
            </div>
          </div>

          {hasFinancials && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Budget" value={money(fin.budget)} />
              <StatCard label="Actual" value={money(fin.actual)} />
              <StatCard label="Forecast (EAC)" value={money(fin.forecast)} />
              <StatCard label="Variance" value={money(fin.variance)} hint={fin.variance < 0 ? "projected overspend" : "within budget"} />
            </div>
          )}

          <div>
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Exceptions — needs a board decision</h3>
            {execHealth.exceptions.length === 0 ? (
              <p className="text-sm text-green-600 font-bold" data-testid="exec-no-exceptions">Every project is green — no exceptions to escalate.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                      <th className="py-1.5 pr-3 font-bold">RAG</th>
                      <th className="py-1.5 pr-3 font-bold">Project</th>
                      <th className="py-1.5 px-2 font-bold text-right">Schedule Δ</th>
                      <th className="py-1.5 px-2 font-bold text-right">Budget Δ</th>
                      <th className="py-1.5 px-2 font-bold text-right">Blockers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execHealth.exceptions.map((e) => <ExceptionRow key={e.projectId} e={e} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {extraCatalogue.length > 0 && (
            <div data-testid="exec-pack-extras">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Additional components</h3>
                <select
                  aria-label="Add component to board pack"
                  className="rounded-none border border-border bg-background px-2 py-1 text-xs"
                  value=""
                  onChange={(e) => { if (e.target.value) setExtraIds((ids) => [...ids, e.target.value]); e.target.value = ""; }}
                >
                  <option value="">+ Add component…</option>
                  {extraCatalogue.filter((c) => !extraIds.includes(c.id)).map((c) => (
                    <option key={c.id} value={c.id}>{c.label} ({c.source})</option>
                  ))}
                </select>
              </div>
              {extras.length === 0 ? (
                <p className="text-xs text-muted-foreground">Optionally add any report or widget from the component library to this pack.</p>
              ) : (
                <div className="space-y-4">
                  {extras.map((c) => (
                    <div key={c.id} data-testid={`exec-pack-extra-${c.id}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-black uppercase tracking-wider">{c.label}</span>
                        <button type="button" aria-label={`Remove ${c.label} from board pack`} className="px-1.5 border border-red-500 text-red-500 text-[10px]"
                          onClick={() => setExtraIds((ids) => ids.filter((id) => id !== c.id))}>✕</button>
                      </div>
                      <LibraryComponentView component={c} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">
            Consolidated live from portfolio health{hasFinancials ? ` + financials (into ${target}${fx?.provenance ? `, FX ${fx.provenance}` : ""})` : ""}.
            Exceptions ranked RED→AMBER then by blockers, schedule slip and budget overrun. Snapshot to freeze a signed, dated board pack. Nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
