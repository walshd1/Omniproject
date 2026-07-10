import { ReportEmpty } from "./ReportEmpty";
import { useMemo, useState } from "react";
import { usePortfolioPriority } from "./use-portfolio-priority";
import { useT } from "../../lib/i18n";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import {
  autoFundByRank,
  evaluateFundingScenario,
  fundAll,
  diffFundingTotals,
  decisionFor,
  type FundingDecisions,
  type FundingDecision,
} from "../../lib/funding-scenario";
import { optimisePortfolio, type OptItem } from "../../lib/portfolio-optimiser";

/**
 * Portfolio Prioritisation & Funding Funnel (backlog #98) — ranks every project on a composite of its
 * RICE / WSJF / MoSCoW / strategic-goal-contribution / benefits-realisation canonical fields (weighted,
 * PMO-tunable via Settings), shown against its cost + capacity footprint, and lets the head of projects
 * run a fund/defer/cut what-if to see the resulting budget/capacity/benefit impact. STATELESS: the score
 * and the scenario are both computed live in the browser on the read model already loaded for the
 * portfolio — only the scoring WEIGHTS are persisted (settings JSON); nothing about the ranking or the
 * funding decisions is ever written back.
 */

const cell = (v: number | null, suffix = ""): string => (v == null ? "—" : `${v}${suffix}`);

function scoreTone(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 66) return "text-green-600";
  if (v >= 33) return "text-amber-500";
  return "text-red-500";
}

function DecisionSelect({ value, label, onChange }: { value: FundingDecision; label: string; onChange: (d: FundingDecision) => void }) {
  return (
    <select
      aria-label={`Funding decision for ${label}`}
      className="rounded-none border border-border bg-background px-2 py-1 text-xs font-bold uppercase tracking-wider"
      value={value}
      onChange={(e) => onChange(e.target.value as FundingDecision)}
    >
      <option value="fund">Fund</option>
      <option value="defer">Defer</option>
      <option value="cut">Cut</option>
    </select>
  );
}

export function PortfolioPrioritisation() {
  const { formatCurrency } = useT();
  const { scored, weights, loading, isError, error, refetch, target } = usePortfolioPriority();
  const [decisions, setDecisions] = useState<FundingDecisions>({});
  const [budgetCap, setBudgetCap] = useState("");
  const [capacityCap, setCapacityCap] = useState("");

  const budgetCapNum = budgetCap.trim() !== "" && Number.isFinite(Number(budgetCap)) ? Number(budgetCap) : null;
  const capacityCapNum = capacityCap.trim() !== "" && Number.isFinite(Number(capacityCap)) ? Number(capacityCap) : null;

  const baseline = useMemo(() => evaluateFundingScenario(scored, fundAll(scored), null, null), [scored]);
  const scenario = useMemo(
    () => evaluateFundingScenario(scored, decisions, budgetCapNum, capacityCapNum),
    [scored, decisions, budgetCapNum, capacityCapNum],
  );
  const delta = useMemo(() => diffFundingTotals(baseline.totals, scenario.totals), [baseline, scenario]);

  const money = (n: number) => formatCurrency(n, target);
  const setDecision = (id: string, d: FundingDecision) => setDecisions((prev) => ({ ...prev, [id]: d }));
  const autoFund = () => setDecisions(autoFundByRank(scored, budgetCapNum, capacityCapNum, decisions));
  const resetDecisions = () => { setDecisions({}); setOptNote(null); };

  // Auto-OPTIMISE: pick the value-maximising project mix under the caps (0/1 knapsack), which beats
  // rank-greedy when a cheaper mid-rank project buys more value than a costly top-rank one. Existing
  // "cut" decisions are honoured as forbids; everything else is set fund/defer from the optimum.
  const [optNote, setOptNote] = useState<string | null>(null);
  const optimise = () => {
    const items: OptItem[] = scored.map((s) => ({
      id: s.projectId, name: s.projectName, value: s.compositeScore ?? 0, cost: s.cost, capacityHours: s.capacityHours,
    }));
    const forbid = scored.filter((s) => decisions[s.projectId] === "cut").map((s) => s.projectId);
    const res = optimisePortfolio(items, { budgetCap: budgetCapNum, capacityCap: capacityCapNum, forbid });
    const sel = new Set(res.selected);
    const next: FundingDecisions = { ...decisions };
    for (const s of scored) {
      if (decisions[s.projectId] === "cut") continue;
      next[s.projectId] = sel.has(s.projectId) ? "fund" : "defer";
    }
    setDecisions(next);
    const uplift = res.greedyValue > 0 ? Math.round(((res.totalValue - res.greedyValue) / res.greedyValue) * 1000) / 10 : 0;
    setOptNote(`Optimised (${res.method}): value ${res.totalValue} vs ${res.greedyValue} rank-greedy${uplift > 0 ? ` — +${uplift}% more value for the same budget` : ""}.`);
  };
  const dirty = Object.keys(decisions).length > 0;
  const hasData = scored.length > 0;

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {!hasData ? (
        <ReportEmpty testId="portfolio-prioritisation-empty">
          No projects to prioritise.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="portfolio-prioritisation">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Projects ranked" value={String(scored.length)} hint={`${scored.filter((s) => s.compositeScore != null).length} scored`} />
            <StatCard label="Funded (scenario)" value={String(scenario.totals.fundedCount)} hint={`${scenario.totals.deferredCount} deferred · ${scenario.totals.cutCount} cut`} />
            <StatCard
              label="Funded cost"
              value={money(scenario.totals.fundedCost)}
              hint={scenario.budget.cap != null ? (scenario.budget.over > 0 ? `over cap by ${money(scenario.budget.over)}` : `${money(scenario.budget.remaining ?? 0)} remaining`) : "no budget cap set"}
            />
            <StatCard
              label="Funded benefit"
              value={money(scenario.totals.fundedBenefit)}
              hint={`${delta.fundedBenefit >= 0 ? "+" : ""}${money(delta.fundedBenefit)} vs funding everything`}
            />
          </div>

          <div className="flex flex-wrap items-end gap-4 border border-border p-3">
            <label className="text-xs flex flex-col gap-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Budget cap ({target})</span>
              <input
                type="number"
                aria-label="Budget cap"
                placeholder="uncapped"
                className="w-32 px-2 py-1 border border-border bg-background font-mono text-xs outline-none focus:border-primary"
                value={budgetCap}
                onChange={(e) => setBudgetCap(e.target.value)}
              />
            </label>
            <label className="text-xs flex flex-col gap-1">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">Capacity cap (hours)</span>
              <input
                type="number"
                aria-label="Capacity cap"
                placeholder="uncapped"
                className="w-32 px-2 py-1 border border-border bg-background font-mono text-xs outline-none focus:border-primary"
                value={capacityCap}
                onChange={(e) => setCapacityCap(e.target.value)}
              />
            </label>
            <button
              type="button"
              data-testid="priority-auto-fund"
              onClick={autoFund}
              className="inline-flex items-center gap-2 border border-border bg-background px-3 py-2 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Auto-fund by rank
            </button>
            <button
              type="button"
              data-testid="priority-optimise"
              onClick={optimise}
              title="Pick the value-maximising project mix under the caps (0/1 knapsack — beats rank-greedy)"
              className="inline-flex items-center gap-2 border border-primary bg-primary text-primary-foreground px-3 py-2 text-xs font-black uppercase tracking-widest hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Optimise (max value)
            </button>
            {dirty && (
              <button
                type="button"
                data-testid="priority-reset-decisions"
                onClick={resetDecisions}
                className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs font-black uppercase tracking-widest hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Reset decisions
              </button>
            )}
            <span className="text-[11px] text-muted-foreground ml-auto">
              Weights — RICE {weights.rice} · WSJF {weights.wsjf} · MoSCoW {weights.moscow} · Strategic {weights.strategic} · Benefit {weights.benefit}
              {" "}(PMO-configurable in Settings → Portfolio prioritisation)
            </span>
          </div>

          {optNote && (
            <p className="text-xs text-primary font-medium border border-primary/40 bg-primary/5 px-3 py-2" data-testid="priority-optimise-note">
              {optNote}
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">#</th>
                  <th className="py-1.5 pr-3 font-bold">Project</th>
                  <th className="py-1.5 px-2 font-bold">Programme</th>
                  <th className="py-1.5 px-2 font-bold text-right">Score</th>
                  <th className="py-1.5 px-2 font-bold text-right">RICE</th>
                  <th className="py-1.5 px-2 font-bold text-right">WSJF</th>
                  <th className="py-1.5 px-2 font-bold text-right">MoSCoW</th>
                  <th className="py-1.5 px-2 font-bold text-right">Strategic</th>
                  <th className="py-1.5 px-2 font-bold text-right">Benefit</th>
                  <th className="py-1.5 px-2 font-bold text-right">Cost</th>
                  <th className="py-1.5 px-2 font-bold text-right">Capacity</th>
                  <th className="py-1.5 px-2 font-bold">Decision</th>
                </tr>
              </thead>
              <tbody>
                {scored.map((p) => {
                  const decision = decisionFor(decisions, p.projectId);
                  return (
                    <tr
                      key={p.projectId}
                      className={`border-b border-border/50 ${decision === "cut" ? "opacity-50" : ""}`}
                      data-testid={`priority-row-${p.projectId}`}
                    >
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{p.rank}</td>
                      <td className="py-2 pr-3 font-bold">{p.projectName}</td>
                      <td className="py-2 px-2 text-muted-foreground">{p.programmeName ?? "Standalone"}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-black ${scoreTone(p.compositeScore)}`}>{cell(p.compositeScore)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{cell(p.riceScore)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{cell(p.wsjf)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{cell(p.moscowScore, "%")}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{cell(p.strategicScore, "%")}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(p.benefitValue)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{money(p.cost)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{p.capacityHours.toLocaleString()}h</td>
                      <td className="py-2 px-2">
                        <DecisionSelect value={decision} label={p.projectName} onChange={(d) => setDecision(p.projectId, d)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Score blends RICE, WSJF, MoSCoW and strategic-goal contribution (issue-level fields averaged per project) with
            risk-adjusted benefit value, weighted as above; a project isn&apos;t penalised for a dimension it doesn&apos;t report.
            Fund / defer / cut is a local what-if — <strong>nothing is written back to any backend</strong>; &quot;Auto-fund by
            rank&quot; greedily funds top-ranked projects until the caps above would be exceeded. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
