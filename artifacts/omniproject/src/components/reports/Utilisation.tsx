import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { num } from "../../lib/num";
import { useT } from "../../lib/i18n";
import type { ProjectItems } from "../../lib/portfolio-value";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { usePortfolioItems } from "./use-portfolio-items";
import { SkillsCapacity } from "./SkillsCapacity";
import { useSkillsPlanning } from "../../lib/skills";

/**
 * Utilisation (timesheets / capacity) — rolls every work item up by its assignee and, per person, sums
 * logged vs estimated vs remaining effort, splits logged effort into billable vs non-billable, and derives
 * a utilisation % (logged ÷ a nominal reporting-period capacity) with overload / under-utilised flags.
 * Answers "who is over- or under-loaded, and how much of their logged time is billable?". STATELESS:
 * derived live from the work items already loaded for the portfolio; nothing is stored.
 */

/** The effort-plane fields a work item may carry. estimateHours/loggedHours/remainingHours/billable are on
 *  the typed read-model (fields.json, group "effort"/"finance"); assignee is the item's owner. All read
 *  defensively as optionals — a backend that doesn't track time simply contributes nothing. */
export interface UtilItem {
  assignee?: string | null;
  loggedHours?: number | null;
  estimateHours?: number | null;
  remainingHours?: number | null;
  billable?: boolean | null;
}

/**
 * Nominal capacity, in hours, of one assignee over the reporting period. Utilisation is logged ÷ this, so
 * it's the single documented assumption of the report. 150h ≈ a working month at ~37.5h/week × 4 weeks; the
 * roll-up takes it as a parameter so a caller (or test) can retune it without touching the maths.
 */
export const PERIOD_CAPACITY_HOURS = 150;

/** Utilisation is "overloaded" at/above capacity and "under" below this floor — everything else is healthy. */
export const OVERLOAD_PCT = 100;
export const UNDER_PCT = 65;

export type UtilFlag = "overloaded" | "under" | "ok";

/** Bucket a utilisation percentage into an overload / under-utilised / healthy flag. */
export function utilisationFlag(util: number): UtilFlag {
  if (util >= OVERLOAD_PCT) return "overloaded";
  if (util < UNDER_PCT) return "under";
  return "ok";
}

export interface UtilRow {
  key: string;
  label: string;
  items: number;
  logged: number;
  estimate: number;
  remaining: number;
  billable: number;
  nonBillable: number;
  /** billable ÷ logged × 100 (0 when nothing logged). */
  billablePct: number;
  /** logged ÷ capacity × 100. */
  utilisation: number;
  flag: UtilFlag;
}

export interface UtilRollup {
  rows: UtilRow[];
  totals: {
    people: number;
    logged: number;
    estimate: number;
    remaining: number;
    billable: number;
    /** portfolio billable ÷ logged × 100. */
    billablePct: number;
    /** count of assignees flagged overloaded. */
    overloaded: number;
    /** count of assignees flagged under-utilised. */
    under: number;
    /** mean per-assignee utilisation %. */
    meanUtilisation: number;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "person";

/** Which assignee an item counts toward, or null to skip it. A timesheet roll-up only cares about items
 *  that carry an effort signal (logged / estimate / remaining hours) — those with none are noise regardless
 *  of who they're assigned to. An effort-bearing item with no assignee lands in "Unassigned". */
function assigneeOf(i: UtilItem): { key: string; label: string } | null {
  if (num(i.loggedHours) <= 0 && num(i.estimateHours) <= 0 && num(i.remainingHours) <= 0) return null;
  const a = i.assignee?.trim();
  if (a) return { key: slug(a), label: a };
  return { key: "unassigned", label: "Unassigned" };
}

interface Working {
  key: string;
  label: string;
  items: number;
  logged: number;
  estimate: number;
  remaining: number;
  billable: number;
}

function blank(p: { key: string; label: string }): Working {
  return { key: p.key, label: p.label, items: 0, logged: 0, estimate: 0, remaining: 0, billable: 0 };
}

/** Consolidate every project's work items into per-assignee utilisation rows + a portfolio total against
 *  `capacityHours`. Pure and derive-only: the same items always produce the same roll-up. */
export function rollupUtilisation(projects: ProjectItems[], capacityHours: number = PERIOD_CAPACITY_HOURS): UtilRollup {
  const cap = capacityHours > 0 ? capacityHours : PERIOD_CAPACITY_HOURS;
  const map = new Map<string, Working>();
  for (const p of projects) {
    for (const it of p.items as unknown as UtilItem[]) {
      const who = assigneeOf(it);
      if (!who) continue;
      const w = map.get(who.key) ?? blank(who);
      const logged = num(it.loggedHours);
      w.items += 1;
      w.logged += logged;
      w.estimate += num(it.estimateHours);
      w.remaining += num(it.remainingHours);
      if (it.billable) w.billable += logged;
      map.set(who.key, w);
    }
  }
  const rows: UtilRow[] = [...map.values()]
    .map((w) => {
      const utilisation = round1((w.logged / cap) * 100);
      return {
        key: w.key,
        label: w.label,
        items: w.items,
        logged: round2(w.logged),
        estimate: round2(w.estimate),
        remaining: round2(w.remaining),
        billable: round2(w.billable),
        nonBillable: round2(w.logged - w.billable),
        billablePct: w.logged > 0 ? round1((w.billable / w.logged) * 100) : 0,
        utilisation,
        flag: utilisationFlag(utilisation),
      };
    })
    // Busiest first: the people carrying the most logged effort lead the table.
    .sort((a, b) => b.logged - a.logged || b.items - a.items || a.key.localeCompare(b.key));

  const logged = round2(rows.reduce((s, r) => s + r.logged, 0));
  const billable = round2(rows.reduce((s, r) => s + r.billable, 0));
  const meanUtilisation = rows.length > 0 ? round1(rows.reduce((s, r) => s + r.utilisation, 0) / rows.length) : 0;
  return {
    rows,
    totals: {
      people: rows.length,
      logged,
      estimate: round2(rows.reduce((s, r) => s + r.estimate, 0)),
      remaining: round2(rows.reduce((s, r) => s + r.remaining, 0)),
      billable,
      billablePct: logged > 0 ? round1((billable / logged) * 100) : 0,
      overloaded: rows.filter((r) => r.flag === "overloaded").length,
      under: rows.filter((r) => r.flag === "under").length,
      meanUtilisation,
    },
  };
}

/** Colour the utilisation cell by flag (overload is the loudest signal). */
function flagTone(flag: UtilFlag): string {
  if (flag === "overloaded") return "text-red-500";
  if (flag === "under") return "text-amber-500";
  return "text-green-600";
}

function FlagChip({ flag }: { flag: UtilFlag }) {
  if (flag === "ok") return <span className="text-[11px] text-muted-foreground">—</span>;
  const cls = flag === "overloaded" ? "bg-red-500/15 text-red-500" : "bg-amber-500/15 text-amber-600";
  const text = flag === "overloaded" ? "Overloaded" : "Under-utilised";
  return (
    <span data-testid={`util-flag-${flag}`} className={`px-1.5 py-0.5 text-[10px] font-black rounded-sm ${cls}`}>{text}</span>
  );
}

export function Utilisation() {
  const { formatNumber } = useT();
  const { projects, loading, isError, error, refetch } = usePortfolioItems();
  const { rows, totals } = useMemo(() => rollupUtilisation(projects), [projects]);
  const { data: skills } = useSkillsPlanning();
  const h = (n: number) => `${formatNumber(n)}h`;

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {rows.length === 0 ? (
        <ReportEmpty testId="utilisation-empty">
          No time data — log effort (estimate / logged / remaining hours) and assign work items to people to see per-assignee utilisation.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="utilisation">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Logged" value={h(totals.logged)} hint={`${totals.people} assignee(s)`} />
            <StatCard label="Billable" value={`${totals.billablePct}%`} hint={`${h(totals.billable)} billable`} />
            <StatCard label="Overloaded" value={String(totals.overloaded)} hint={totals.under > 0 ? `${totals.under} under-utilised` : "at/over capacity"} />
            <StatCard label="Mean utilisation" value={`${totals.meanUtilisation}%`} hint={`vs ${PERIOD_CAPACITY_HOURS}h capacity`} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <th className="py-1.5 pr-3 font-bold">Assignee</th>
                  <th className="py-1.5 px-2 font-bold text-right">Items</th>
                  <th className="py-1.5 px-2 font-bold text-right">Logged</th>
                  <th className="py-1.5 px-2 font-bold text-right">Estimate</th>
                  <th className="py-1.5 px-2 font-bold text-right">Remaining</th>
                  <th className="py-1.5 px-2 font-bold text-right">Billable</th>
                  <th className="py-1.5 px-2 font-bold text-right">Utilisation</th>
                  <th className="py-1.5 px-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border/50 align-top" data-testid={`utilisation-row-${r.key}`}>
                    <td className="py-2 pr-3 font-bold">{r.label}</td>
                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">{r.items}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{h(r.logged)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{h(r.estimate)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{h(r.remaining)}</td>
                    <td className="py-2 px-2 text-right tabular-nums" data-testid={`utilisation-row-${r.key}-billable`}>{r.billablePct}%</td>
                    <td className={`py-2 px-2 text-right tabular-nums font-black ${flagTone(r.flag)}`}>{r.utilisation}%</td>
                    <td className="py-2 px-2"><FlagChip flag={r.flag} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Work items grouped by assignee and ordered by logged effort (busiest first). Utilisation is logged hours ÷ a nominal
            reporting-period capacity of {PERIOD_CAPACITY_HOURS}h per person; a person is flagged Overloaded at/above {OVERLOAD_PCT}%
            and Under-utilised below {UNDER_PCT}%. Billable % is billable logged hours over total logged. Derived live; nothing is stored.
          </p>
          <SkillsCapacity resources={skills?.matrix ?? []} demand={skills?.demand ?? []} />
        </div>
      )}
    </DataState>
  );
}
