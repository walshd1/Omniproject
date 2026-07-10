import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { num } from "../../lib/num";
import { moscowWeight } from "../../lib/portfolio-priority";
import type { ProjectItems } from "../../lib/portfolio-value";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { usePortfolioItems } from "./use-portfolio-items";

/**
 * Demand Intake (demand / intake funnel with prioritisation) — treats every work item as a unit of
 * demand and flows it through the intake funnel derived from its status (backlog / idea → triaged →
 * approved → in delivery → done). Answers "what is asking for the portfolio's capacity, where is it in
 * the pipeline, and which requests should we pull next?". Shows the count-by-stage funnel, a prioritised
 * intake queue (top demand by RICE / WSJF with requester + MoSCoW + strategic contribution), and headline
 * StatCards. STATELESS: derived live from the work items already loaded for the portfolio; nothing is
 * stored — the same items always produce the same funnel + queue.
 */

/** The demand-plane fields a work item may carry. riceScore/wsjf/moscow/strategicContribution live in the
 *  agile/strategy field groups and requester in the service group; a backend passes them through the
 *  read-model, so they're read defensively as optionals. `status` drives the funnel stage. */
export interface DemandItem {
  id?: string | null;
  title?: string | null;
  status?: string | null;
  requester?: string | null;
  assignee?: string | null;
  riceScore?: number | null;
  wsjf?: number | null;
  moscow?: string | null;
  strategicContribution?: number | null;
}

export type IntakeStage = "backlog" | "triaged" | "approved" | "delivery" | "done";

/** The intake funnel in flow order — every stage renders even at zero count so the funnel reads as a pipe. */
export const INTAKE_STAGES: readonly { key: IntakeStage; label: string }[] = [
  { key: "backlog", label: "Backlog / Idea" },
  { key: "triaged", label: "Triaged" },
  { key: "approved", label: "Approved" },
  { key: "delivery", label: "In delivery" },
  { key: "done", label: "Done" },
];

/** Map a free-form status into an intake funnel stage (backend vocabulary preserved). Requests that fell
 *  out of the funnel (cancelled / rejected / won't-do / duplicate) return null and are excluded from
 *  demand — they are no longer asking for capacity. Anything demand-like with no clearer signal lands in
 *  the backlog (the funnel mouth). */
export function intakeStage(status?: string | null): IntakeStage | null {
  const s = (status ?? "").toLowerCase().trim();
  if (!s) return null;
  if (/cancel|reject|declin|won.?t|will.?not|drop|dupli|abandon|obsolete/.test(s)) return null;
  if (/done|closed|complete|resolved|released|shipped|deployed|live/.test(s)) return "done";
  if (/progress|review|delivery|deliver|doing|active|develop|build|wip|testing|qa\b|verify|started/.test(s)) return "delivery";
  if (/approv|select|accept|committed|scheduled|planned|ready.?for.?dev|prioriti/.test(s)) return "approved";
  if (/triag|to.?do|todo|open|ready|refin|groom|assess|qualif|candidate|new\b/.test(s)) return "triaged";
  return "backlog";
}

export interface IntakeQueueRow {
  id: string;
  title: string;
  project: string;
  stage: IntakeStage;
  stageLabel: string;
  requester: string | null;
  riceScore: number | null;
  wsjf: number | null;
  /** MoSCoW as read (free-form label preserved), plus its 0–100 weight for ranking. */
  moscow: string | null;
  moscowWeight: number | null;
  strategicContribution: number | null;
}

export interface DemandStageRow {
  key: IntakeStage;
  label: string;
  count: number;
}

export interface DemandIntakeRollup {
  stages: DemandStageRow[];
  queue: IntakeQueueRow[];
  totals: {
    /** Total units of demand (items with a live funnel stage). */
    demand: number;
    /** Approved but not yet pulled into delivery — the ready-to-start queue depth. */
    approvedNotStarted: number;
    /** Mean RICE across the demand that reports it, or null when none does. */
    meanRice: number | null;
  };
}

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** How many top demand rows the prioritised intake queue surfaces. */
const QUEUE_LIMIT = 12;

/** Rank two queue rows: highest RICE first, then WSJF, then MoSCoW weight — a null on a dimension sorts
 *  after any measured value on it, and id breaks ties for a deterministic order. Mirrors the "score on
 *  what it reports" discipline in portfolio-priority. */
function byPriority(a: IntakeQueueRow, b: IntakeQueueRow): number {
  const cmp = (x: number | null, y: number | null) => (x == null ? (y == null ? 0 : 1) : y == null ? -1 : y - x);
  return cmp(a.riceScore, b.riceScore) || cmp(a.wsjf, b.wsjf) || cmp(a.moscowWeight, b.moscowWeight) || a.id.localeCompare(b.id);
}

/** Consolidate every project's work items into the intake funnel + prioritised queue + headline totals.
 *  Pure and derive-only: the same items always produce the same roll-up. */
export function rollupDemandIntake(projects: ProjectItems[]): DemandIntakeRollup {
  const counts: Record<IntakeStage, number> = { backlog: 0, triaged: 0, approved: 0, delivery: 0, done: 0 };
  const rows: IntakeQueueRow[] = [];
  let riceSum = 0;
  let riceN = 0;

  for (const p of projects) {
    for (const raw of p.items as unknown as DemandItem[]) {
      const stage = intakeStage(raw.status);
      if (!stage) continue; // fell out of the funnel — not live demand
      counts[stage] += 1;

      const rice = typeof raw.riceScore === "number" && Number.isFinite(raw.riceScore) ? raw.riceScore : null;
      if (rice != null) {
        riceSum += rice;
        riceN += 1;
      }
      const wsjf = typeof raw.wsjf === "number" && Number.isFinite(raw.wsjf) ? raw.wsjf : null;
      const contribution =
        typeof raw.strategicContribution === "number" && Number.isFinite(raw.strategicContribution)
          ? clampPct(raw.strategicContribution)
          : null;
      const moscow = raw.moscow?.trim() || null;

      rows.push({
        id: (raw.id ?? "").toString() || `${p.projectId}-${rows.length}`,
        title: raw.title?.trim() || "Untitled demand",
        project: p.projectName,
        stage,
        stageLabel: INTAKE_STAGES.find((s) => s.key === stage)!.label,
        requester: raw.requester?.trim() || raw.assignee?.trim() || null,
        riceScore: rice,
        wsjf,
        moscow,
        moscowWeight: moscowWeight(moscow),
        strategicContribution: contribution,
      });
    }
  }

  const stages: DemandStageRow[] = INTAKE_STAGES.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }));
  const queue = rows.sort(byPriority).slice(0, QUEUE_LIMIT);
  return {
    stages,
    queue,
    totals: {
      demand: rows.length,
      approvedNotStarted: counts.approved,
      meanRice: riceN > 0 ? Math.round(riceSum / riceN) : null,
    },
  };
}

/** Colour a stage cell by where it sits in the funnel — mouth (backlog) muted, delivery hot, done cool. */
const STAGE_TONE: Record<IntakeStage, string> = {
  backlog: "bg-muted-foreground/40",
  triaged: "bg-sky-500/70",
  approved: "bg-violet-500/70",
  delivery: "bg-amber-500/80",
  done: "bg-green-500/70",
};

function MoscowChip({ label }: { label: string }) {
  const w = moscowWeight(label);
  const cls =
    w === 100 ? "bg-red-500/15 text-red-500" : w === 66 ? "bg-amber-500/15 text-amber-600" : w === 33 ? "bg-sky-500/15 text-sky-600" : "bg-muted text-muted-foreground";
  return <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide rounded-sm ${cls}`}>{label}</span>;
}

export function DemandIntake() {
  const { projects, loading, isError, error, refetch } = usePortfolioItems();
  const { stages, queue, totals } = useMemo(() => rollupDemandIntake(projects), [projects]);
  const maxStage = Math.max(1, ...stages.map((s) => s.count));

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {totals.demand === 0 ? (
        <ReportEmpty testId="demand-intake-empty">
          No demand to triage — set a status (and optionally requester, RICE, WSJF or MoSCoW) on work items to see the intake
          funnel and the prioritised queue of what to pull next.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="demand-intake">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard label="Total demand" value={String(totals.demand)} hint="items in the funnel" />
            <StatCard label="Approved · not started" value={String(totals.approvedNotStarted)} hint="ready to pull into delivery" />
            <StatCard label="Mean RICE" value={totals.meanRice == null ? "—" : String(totals.meanRice)} hint="across scored demand" />
          </div>

          <div className="space-y-1.5" data-testid="demand-intake-funnel">
            {stages.map((s) => (
              <div key={s.key} className="flex items-center gap-2" data-testid={`demand-intake-stage-${s.key}`}>
                <div className="w-28 shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground text-right pr-1">{s.label}</div>
                <div className="flex-1 h-5 bg-muted/40 relative">
                  <div className={`h-full ${STAGE_TONE[s.key]}`} style={{ width: `${Math.round((s.count / maxStage) * 100)}%` }} />
                </div>
                <div className="w-8 shrink-0 text-right text-sm font-black tabular-nums" data-testid={`demand-intake-stage-${s.key}-count`}>{s.count}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">#</th>
                  <th className="py-1.5 px-2 font-bold">Demand</th>
                  <th className="py-1.5 px-2 font-bold">Stage</th>
                  <th className="py-1.5 px-2 font-bold">Requester</th>
                  <th className="py-1.5 px-2 font-bold">MoSCoW</th>
                  <th className="py-1.5 px-2 font-bold text-right">RICE</th>
                  <th className="py-1.5 px-2 font-bold text-right">WSJF</th>
                  <th className="py-1.5 px-2 font-bold text-right">Strat.</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((r, i) => (
                  <tr key={r.id} className="border-b border-border/50 align-top" data-testid={`demand-intake-row-${r.id}`}>
                    <td className="py-2 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="py-2 px-2 font-bold">
                      {r.title}
                      <div className="text-[10px] font-normal text-muted-foreground">{r.project}</div>
                    </td>
                    <td className="py-2 px-2 text-[11px]">{r.stageLabel}</td>
                    <td className="py-2 px-2 text-muted-foreground">{r.requester ?? "—"}</td>
                    <td className="py-2 px-2">{r.moscow ? <MoscowChip label={r.moscow} /> : <span className="text-[11px] text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-black">{r.riceScore == null ? "—" : r.riceScore}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.wsjf == null ? "—" : r.wsjf}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.strategicContribution == null ? "—" : `${r.strategicContribution}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Every work item is treated as demand and placed in the intake funnel by its status (requests that were cancelled,
            rejected or dropped fall out and are not counted). The queue ranks the top {QUEUE_LIMIT} live requests by RICE, then
            WSJF, then MoSCoW — the order to pull them into delivery. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
