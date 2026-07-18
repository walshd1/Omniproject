import { ReportEmpty } from "./ReportEmpty";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetPortfolioHealth } from "@workspace/api-client-react";
import { componentsFor } from "@workspace/backend-catalogue";
import { buildExecHealth, execHeadline, type ExecException, type Rag } from "../../lib/exec-pack";
import { resolveHealthDrills, type ResolvedDrillTo } from "../../lib/drill-to";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { SnapshotButton } from "./SnapshotControls";
import { LibraryComponentView } from "../library/LibraryComponentView";
import { resolveLibraryComponent } from "../../lib/component-library";
import { usePortfolioFinancials } from "./use-portfolio-financials";

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

/** An exceptions-table cell that's also a drill-through when `canDrill` — same round trip as
 *  PortfolioKpi's DrillFigure, just a `<td>`'s worth instead of a card figure (backlog #122/#132). */
function DrillCell({
  drill, canDrill, ariaLabel, testId, valueClassName, children,
}: {
  drill: ResolvedDrillTo | null;
  canDrill: boolean;
  ariaLabel: string;
  testId: string;
  valueClassName: string;
  children: ReactNode;
}) {
  return (
    <td className={`py-2 px-2 text-right tabular-nums ${valueClassName}`}>
      {canDrill && drill ? (
        <Link
          href={drill.href}
          className="underline decoration-dotted underline-offset-2 hover:no-underline"
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {children}
        </Link>
      ) : (
        children
      )}
    </td>
  );
}

function ExceptionRow({ e }: { e: ExceptionView }) {
  const style = RAG_STYLE[e.rag];
  const { blockers, schedule, budget } = resolveHealthDrills(e);
  const blockersDrill = blockers.drill, scheduleDrill = schedule.drill, budgetDrill = budget.drill;
  const canDrillBlockers = blockers.canDrill, canDrillSchedule = schedule.canDrill, canDrillBudget = budget.canDrill;
  return (
    <tr className="border-b border-border/50" data-testid={`exec-exception-${e.projectId}`}>
      <td className="py-2 pr-3">
        <span className={`inline-flex items-center gap-1.5 font-black uppercase text-[10px] tracking-widest ${style.text}`}>
          <span className={`w-2 h-2 rounded-full ${style.dot}`} />{e.rag}
        </span>
      </td>
      <td className="py-2 pr-3 font-bold">{e.projectName}</td>
      <DrillCell
        drill={scheduleDrill}
        canDrill={canDrillSchedule}
        ariaLabel={`${scheduleDrill?.label ?? "Overdue items"} for ${e.projectName}`}
        testId={`exec-schedule-drill-${e.projectId}`}
        valueClassName={e.scheduleVarianceDays < 0 ? "text-red-500" : ""}
      >
        {e.scheduleVarianceDays > 0 ? "+" : ""}{e.scheduleVarianceDays}d
      </DrillCell>
      <DrillCell
        drill={budgetDrill}
        canDrill={canDrillBudget}
        ariaLabel={`${budgetDrill?.label ?? "Cost-incurring items"} for ${e.projectName}`}
        testId={`exec-budget-drill-${e.projectId}`}
        valueClassName={e.budgetVariancePercentage > 0 ? "text-red-500" : "text-green-600"}
      >
        {e.budgetVariancePercentage > 0 ? "+" : ""}{e.budgetVariancePercentage}%
      </DrillCell>
      <DrillCell
        drill={blockersDrill}
        canDrill={canDrillBlockers}
        ariaLabel={`${blockersDrill?.label ?? "Blocked items"} for ${e.projectName}`}
        testId={`exec-blockers-drill-${e.projectId}`}
        valueClassName={e.activeBlockersCount > 0 ? "text-amber-500" : "text-muted-foreground"}
      >
        {e.activeBlockersCount}
      </DrillCell>
    </tr>
  );
}

type ExceptionView = ExecException;

export function ExecBoardPack() {
  const { formatCurrency } = useT();
  const { projects, consolidated: financials, target, setReporting, options, projLoading, isError: projErr, error: projError, refetch, settings, fx } = usePortfolioFinancials();
  const health = useGetPortfolioHealth();
  // Extra library components chosen for THIS board pack, on top of the fixed sections below —
  // componentsFor("export") is the same unified library the Reports page + dashboards draw from.
  // Only offer components with a real inline renderer (a surfaced-via report has nowhere to render).
  const extraCatalogue = useMemo(() => componentsFor("export").filter((c) => resolveLibraryComponent(c)), []);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const extras = extraCatalogue.filter((c) => extraIds.includes(c.id));

  // Health is the spine; financials are an optional overlay, so don't block the pack on the finance fan-out.
  const loading = projLoading || health.isLoading;

  const execHealth = useMemo(() => buildExecHealth(health.data ?? []), [health.data]);

  const money = (n: number) => formatCurrency(n, target);
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
        <ReportEmpty testId="exec-pack-empty">
          No portfolio data — connect a backend so projects report RAG status, schedule and budget variance.
        </ReportEmpty>
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
