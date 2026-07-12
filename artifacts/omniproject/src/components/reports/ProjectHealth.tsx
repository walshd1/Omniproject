import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { convertAmount } from "../../lib/currency";
import { num } from "../../lib/num";
import type { ProjectItems } from "../../lib/portfolio-value";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { ProportionBar } from "../charts/bars";
import { usePortfolioItems } from "./use-portfolio-items";
import { useTrend } from "../../lib/trends";
import { TrendChart } from "./TrendChart";

/**
 * Project Health (predictive project-health / risk scoring) — derives a composite 0–100 HEALTH SCORE and a
 * RAG band per project from the delivery-risk signals its work items already carry: RAG health status, risk
 * level, blocked flags, schedule slip (overdue open items), budget pressure (burn ahead of delivery), benefit
 * confidence and the open-vs-done ratio. Answers "which projects are at risk, and what's driving it?" — a
 * heatmap distribution, an at-risk ranking (worst first, with the driving factors), and portfolio StatCards.
 * STATELESS: derived live from the work items + the FX table already loaded for the portfolio; nothing is
 * stored, so the same items always produce the same scores.
 */

/** The delivery-risk fields a work item may carry. All are on the typed read-model (quality/financial/
 *  benefits/schedule field groups); read defensively as optionals so a backend that omits any group is
 *  simply scored on the signals it does surface (mirrors StrategyAlignment's optional-field handling). */
export interface HealthItem {
  id: string;
  status?: string | null;
  dueDate?: string | Date | null;
  healthStatus?: string | null;
  riskLevel?: string | null;
  blocked?: boolean | null;
  blockedReason?: string | null;
  budget?: number | null;
  actualCost?: number | null;
  benefitConfidence?: number | null;
}

export type Rag = "green" | "amber" | "red" | "none";

/** Normalise a free-form health status into a RAG bucket (backend vocabulary preserved). */
export function ragBucket(status?: string | null): Rag {
  const s = (status ?? "").toLowerCase().trim();
  if (!s) return "none";
  if (/green|on.?track|on.?plan|healthy|complete|good|stable/.test(s)) return "green";
  if (/red|off.?track|critical|blocked|fail|breach|slip/.test(s)) return "red";
  if (/amber|at.?risk|yellow|warn|delay|concern|risk/.test(s)) return "amber";
  return "none";
}

/** Severity (0..1) of a free-form risk level — high/critical dominate, medium is half-weight. */
export function riskSeverity(level?: string | null): number | null {
  const s = (level ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/critical|severe|very.?high|high/.test(s)) return 1;
  if (/medium|moderate|mid/.test(s)) return 0.5;
  if (/low|minor|negligible|none/.test(s)) return 0;
  return null;
}

/** A work item is delivered when its status reads as done/closed. */
export function isDone(status?: string | null): boolean {
  return /done|closed|complete|resolved|shipped|deliver|accept/.test((status ?? "").toLowerCase());
}
/** Terminal (done OR cancelled) items are excluded from schedule-slip — a cancelled item can't be overdue. */
function isTerminal(status?: string | null): boolean {
  return isDone(status) || /cancel|won.?t|abandon|reject|dupl/.test((status ?? "").toLowerCase());
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Turn a possibly-stringly due date into an epoch ms, or null when absent/unparseable. */
function dueMs(d?: string | Date | null): number | null {
  if (!d) return null;
  const t = d instanceof Date ? d.getTime() : Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

export interface HealthFactor {
  key: string;
  label: string;
  /** Points this factor deducts from the 100-point health score (rounded, >0). */
  penalty: number;
}

export interface ProjectHealthRow {
  key: string;
  label: string;
  items: number;
  done: number;
  open: number;
  /** Composite health score, 0 (critical) – 100 (healthy). */
  score: number;
  band: "green" | "amber" | "red";
  overdue: number;
  blockedCount: number;
  /** actualCost ÷ budget × 100 (spend to date), or null when no budget is set. */
  burn: number | null;
  /** Mean benefit confidence (0–100) across items that report it, or null when none do. */
  confidence: number | null;
  rag: { green: number; amber: number; red: number };
  /** The negative drivers behind the score, worst first (empty when nothing is dragging it down). */
  factors: HealthFactor[];
}

export interface ProjectHealthRollup {
  rows: ProjectHealthRow[];
  totals: { projects: number; items: number; red: number; amber: number; green: number; meanHealth: number };
}

/** Score band: green ≥ 70, amber ≥ 40, red below. */
export function healthBand(score: number): "green" | "amber" | "red" {
  if (score >= 70) return "green";
  if (score >= 40) return "amber";
  return "red";
}

// Weightings (sum to 100) — how many points each fully-saturated risk signal can deduct.
const W = { status: 20, slip: 18, blocked: 14, risk: 14, budget: 14, confidence: 10, backlog: 10 } as const;

/** Score ONE project (its work items) into a health row, in `reportingCurrency`. Pure and derive-only:
 *  the same items + `now` always produce the same score. `now` is injectable so schedule slip is testable. */
export function scoreProjectHealth(project: ProjectItems, reportingCurrency: string, rates?: Record<string, number>, now: number = Date.now()): ProjectHealthRow {
  const conv = (n: number) => convertAmount(n, project.currency, reportingCurrency, rates);
  let items = 0, done = 0, overdue = 0, blockedCount = 0;
  let budgetSum = 0, costSum = 0;
  let confSum = 0, confN = 0;
  let riskSum = 0, riskN = 0;
  const rag = { green: 0, amber: 0, red: 0 };

  for (const it of project.items as unknown as HealthItem[]) {
    items += 1;
    if (isDone(it.status)) done += 1;
    const due = dueMs(it.dueDate);
    if (due != null && due < now && !isTerminal(it.status)) overdue += 1;
    if (it.blocked) blockedCount += 1;
    budgetSum += conv(num(it.budget));
    costSum += conv(num(it.actualCost));
    if (it.benefitConfidence != null && Number.isFinite(it.benefitConfidence)) {
      confSum += Math.min(100, Math.max(0, it.benefitConfidence));
      confN += 1;
    }
    const sev = riskSeverity(it.riskLevel);
    if (sev != null) { riskSum += sev; riskN += 1; }
    const b = ragBucket(it.healthStatus);
    if (b !== "none") rag[b] += 1;
  }

  const open = items - done;
  const donePct = items > 0 ? done / items : 0;
  const openRatio = items > 0 ? open / items : 0;
  const slipRate = items > 0 ? overdue / items : 0;
  const blockedRate = items > 0 ? blockedCount / items : 0;
  const riskRate = riskN > 0 ? riskSum / riskN : 0;
  const ragReported = rag.green + rag.amber + rag.red;
  const statusRisk = ragReported > 0 ? (rag.red + 0.5 * rag.amber) / ragReported : 0;
  const burn = budgetSum > 0 ? costSum / budgetSum : null;
  // Budget PRESSURE = spending ahead of delivery: burn running past the fraction of work done.
  const budgetPressure = burn == null ? 0 : clamp01(burn - donePct);
  const confidence = confN > 0 ? Math.round(confSum / confN) : null;
  const lowConf = confN > 0 ? clamp01((100 - confSum / confN) / 100) : 0;

  const raw: HealthFactor[] = [
    { key: "status", label: "RAG status", penalty: statusRisk * W.status },
    { key: "slip", label: "Schedule slip", penalty: slipRate * W.slip },
    { key: "blocked", label: "Blocked", penalty: blockedRate * W.blocked },
    { key: "risk", label: "Risk level", penalty: riskRate * W.risk },
    { key: "budget", label: "Budget burn", penalty: budgetPressure * W.budget },
    { key: "confidence", label: "Benefit confidence", penalty: lowConf * W.confidence },
    { key: "backlog", label: "Open backlog", penalty: openRatio * W.backlog },
  ];
  const deduction = raw.reduce((s, f) => s + f.penalty, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));
  const factors = raw
    .filter((f) => f.penalty >= 0.5)
    .map((f) => ({ ...f, penalty: Math.round(f.penalty) }))
    .sort((a, b) => b.penalty - a.penalty || a.key.localeCompare(b.key));

  return {
    key: project.projectId,
    label: project.projectName,
    items,
    done,
    open,
    score,
    band: healthBand(score),
    overdue,
    blockedCount,
    burn: burn == null ? null : round1(burn * 100),
    confidence,
    rag,
    factors,
  };
}

/** Score every project into a health ranking + portfolio totals, in `reportingCurrency`. Pure and
 *  derive-only: worst health first so the projects that need attention lead the table. */
export function rollupProjectHealth(projects: ProjectItems[], reportingCurrency: string, rates?: Record<string, number>, now: number = Date.now()): ProjectHealthRollup {
  const rows = projects
    .filter((p) => p.items.length > 0)
    .map((p) => scoreProjectHealth(p, reportingCurrency, rates, now))
    // Worst health first (lowest score leads); key breaks ties deterministically.
    .sort((a, b) => a.score - b.score || a.key.localeCompare(b.key));

  const red = rows.filter((r) => r.band === "red").length;
  const amber = rows.filter((r) => r.band === "amber").length;
  const green = rows.filter((r) => r.band === "green").length;
  const items = rows.reduce((s, r) => s + r.items, 0);
  const meanHealth = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;
  return { rows, totals: { projects: rows.length, items, red, amber, green, meanHealth } };
}

const BAND_CLS: Record<"green" | "amber" | "red", string> = {
  green: "bg-green-500/15 text-green-600",
  amber: "bg-amber-500/15 text-amber-600",
  red: "bg-red-500/15 text-red-500",
};

function ScoreBadge({ score, band }: { score: number; band: "green" | "amber" | "red" }) {
  return (
    <span data-testid={`health-band-${band}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm font-black tabular-nums ${BAND_CLS[band]}`}>
      {score}
      <span className="text-[9px] uppercase tracking-widest">{band}</span>
    </span>
  );
}

function RagChips({ rag }: { rag: { green: number; amber: number; red: number } }) {
  const parts: { k: "green" | "amber" | "red"; n: number }[] = [
    { k: "red", n: rag.red },
    { k: "amber", n: rag.amber },
    { k: "green", n: rag.green },
  ];
  if (rag.green + rag.amber + rag.red === 0) return <span className="text-[11px] text-muted-foreground">—</span>;
  return (
    <span className="inline-flex gap-1">
      {parts.filter((p) => p.n > 0).map((p) => (
        <span key={p.k} data-testid={`rag-${p.k}`} className={`px-1.5 py-0.5 text-[10px] font-black tabular-nums rounded-sm ${BAND_CLS[p.k]}`}>{p.n}</span>
      ))}
    </span>
  );
}

/** A single stacked bar showing the red/amber/green split of scored projects — the RAG heatmap.
 *  Rendered through the shared ProportionBar primitive. */
function DistributionBar({ red, amber, green }: { red: number; amber: number; green: number }) {
  return (
    <ProportionBar
      height="h-2.5"
      className="rounded-sm border border-border"
      testId="health-distribution"
      testIdPrefix="health-dist"
      segments={[
        { key: "red", value: red, className: "bg-red-500" },
        { key: "amber", value: amber, className: "bg-amber-500" },
        { key: "green", value: green, className: "bg-green-500" },
      ]}
    />
  );
}

export function ProjectHealth() {
  const { projects, loading, isError, error, refetch, target, rates } = usePortfolioItems();
  const { rows, totals } = useMemo(() => rollupProjectHealth(projects, target, rates), [projects, target, rates]);

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {rows.length === 0 ? (
        <ReportEmpty testId="project-health-empty">
          No project data to score — add work items carrying delivery-risk signals (health / risk level, blocked flags, due
          dates, budget vs actual cost, benefit confidence) to see a predictive project-health ranking.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="project-health">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="At risk (red)" value={String(totals.red)} hint={`${totals.projects} project(s) scored`} />
            <StatCard label="Watch (amber)" value={String(totals.amber)} hint="tracking with concerns" />
            <StatCard label="Healthy (green)" value={String(totals.green)} hint="on track" />
            <StatCard label="Mean health" value={String(totals.meanHealth)} hint={`${totals.items} item(s) assessed`} />
          </div>
          <DistributionBar red={totals.red} amber={totals.amber} green={totals.green} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Project</th>
                  <th className="py-1.5 px-2 font-bold text-right">Progress</th>
                  <th className="py-1.5 px-2 font-bold text-right">Overdue</th>
                  <th className="py-1.5 px-2 font-bold text-right">Blocked</th>
                  <th className="py-1.5 px-2 font-bold text-right">Burn</th>
                  <th className="py-1.5 px-2 font-bold text-right">Confidence</th>
                  <th className="py-1.5 px-2 font-bold">Item RAG</th>
                  <th className="py-1.5 px-2 font-bold text-right">Health</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border/50 align-top" data-testid={`project-health-row-${r.key}`}>
                    <td className="py-2 pr-3 font-bold">
                      {r.label}
                      {r.factors.length > 0 && (
                        <div className="text-[10px] font-normal text-muted-foreground" data-testid={`project-health-row-${r.key}-drivers`}>
                          Drivers: {r.factors.map((f) => `${f.label} (−${f.penalty})`).join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.done}/{r.items}</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${r.overdue > 0 ? "text-red-500 font-bold" : "text-muted-foreground"}`}>{r.overdue}</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${r.blockedCount > 0 ? "text-amber-600 font-bold" : "text-muted-foreground"}`}>{r.blockedCount}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.burn == null ? "—" : `${r.burn}%`}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.confidence == null ? "—" : `${r.confidence}%`}</td>
                    <td className="py-2 px-2"><RagChips rag={r.rag} /></td>
                    <td className="py-2 px-2 text-right"><ScoreBadge score={r.score} band={r.band} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HealthTrajectory />
          <p className="text-[11px] text-muted-foreground">
            Each project scores 0–100 from the delivery-risk signals its work items carry — RAG health, risk level, blocked
            flags, schedule slip (overdue open items), budget burn running ahead of delivery, benefit confidence and the
            open-vs-done ratio — banded green (≥70) / amber (≥40) / red, worst health first. Budget figures consolidated into
            the reporting currency. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}

/**
 * Health trajectory — the trend view over the durable history the retention layer keeps (completion
 * and open-blocker movement). The snapshot itself is stateless; this panel reads the *retained*
 * time-series. Until a retention source is populated (self-host history domain), it shows an honest
 * "history not yet retained" note rather than a fabricated line. See docs/HISTORY-RETENTION.md.
 */
export function HealthTrajectory() {
  const completion = useTrend({ metric: "completionPct", grain: "month" });
  const blockers = useTrend({ metric: "openBlockers", grain: "month" });
  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-border pt-4" data-testid="project-health-trajectory">
      <TrendChart series={completion.data} label="Completion trajectory" unit="%" />
      <TrendChart series={blockers.data} label="Open blockers" />
    </section>
  );
}
