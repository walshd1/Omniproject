import { ReportEmpty } from "./ReportEmpty";
import { useMemo } from "react";
import { num } from "../../lib/num";
import { DAY_MS } from "../../lib/date-utils";
import { useT } from "../../lib/i18n";
import type { ProjectItems } from "../../lib/portfolio-value";
import { DataState } from "../DataState";
import { StatCard } from "./StatCard";
import { Badge } from "../tiles/Badge";
import { usePortfolioItems } from "./use-portfolio-items";
import { classifyStage } from "../../lib/status-vocab";
import { ReportTable } from "./ReportTable";

/**
 * Value Stream Flow (value-stream / flow metrics) — groups every work item by its value stream (or, when a
 * backend doesn't set one, its first label, else "Unassigned"), and rolls up per stream the flow health:
 * WIP (in-progress count), flow load (story points in flight), aging of the in-progress items, throughput
 * (items finished in the recent window) and mean cycle time of the finished ones. Answers "where is work
 * piling up, how old is the in-flight work, and how fast is each value stream finishing things?".
 * STATELESS: derived live from the work items already loaded for the portfolio; nothing is stored.
 */

/** How long the throughput window looks back, and how old an in-progress item must be to count as "aging". */
export const THROUGHPUT_WINDOW_DAYS = 30;
export const AGING_THRESHOLD_DAYS = 14;

/** The flow-plane fields a work item may carry. status/createdAt/updatedAt/startDate/dueDate/storyPoints are
 *  on the typed read-model; valueStream is a registry field a backend passes through, so it (and everything
 *  used here) is read defensively as an optional — a bad/absent value degrades, it never throws. */
export interface FlowItem {
  valueStream?: string | null;
  labels?: string[] | null;
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  storyPoints?: number | null;
}

export type FlowState = "wip" | "done" | "other";

/** Bucket a free-form backend status into a flow state (backend vocabulary preserved). Conventional buckets
 *  are backlog/todo/in_progress/in_review/done/cancelled, but any backend's own words are matched by shape.
 *  Cancelled work has left the value stream, so it collapses into "other" alongside backlog/todo. */
export function flowState(status?: string | null): FlowState {
  const stage = classifyStage(status);
  return stage === "cancelled" ? "other" : stage;
}

/** Parse a backend date string to epoch ms, or null when it's absent / unparseable — the single guard that
 *  keeps every downstream day-count finite (Date.parse yields NaN for junk, which we never let through). */
export function parseDateMs(v?: string | null): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Whole days between two epoch-ms instants, clamped at 0 (never negative, never NaN). */
function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}

export interface FlowStreamRow {
  key: string;
  label: string;
  items: number;
  /** Items in an in-progress state right now. */
  wip: number;
  /** Story points carried by the in-progress items (the load in flight). */
  flowLoad: number;
  /** Items in a done state. */
  done: number;
  /** Done items whose completion (updatedAt) falls inside the recent window. */
  throughput: number;
  /** Mean age in days of the in-progress items (start/createdAt → now), or null when none have a date. */
  meanAge: number | null;
  /** Oldest in-progress item's age in days, or null when none have a date. */
  maxAge: number | null;
  /** In-progress items older than the aging threshold. */
  agingOver: number;
  /** Mean cycle time in days of the done items with a computable span, or null when none do. */
  meanCycle: number | null;
}

export interface FlowRollup {
  streams: FlowStreamRow[];
  totals: {
    streams: number;
    items: number;
    wip: number;
    throughput: number;
    agingOver: number;
    /** Portfolio-wide mean cycle time (days) across every done item with a computable span, or null. */
    meanCycle: number | null;
  };
  config: { agingThresholdDays: number; throughputWindowDays: number };
}

export interface FlowConfig {
  /** Instant "now" is measured from — injectable so the roll-up is pure/deterministic in tests. */
  now?: number;
  agingThresholdDays?: number;
  throughputWindowDays?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "stream";

/** Which value stream an item belongs to: its explicit valueStream, else its first non-empty label, else
 *  "Unassigned" — every item is placed, so the flow picture is complete. */
function streamOf(i: FlowItem): { key: string; label: string } {
  const v = i.valueStream?.trim();
  if (v) return { key: slug(v), label: v };
  const firstLabel = (i.labels ?? []).map((l) => l?.trim()).find((l): l is string => !!l);
  if (firstLabel) return { key: slug(firstLabel), label: firstLabel };
  return { key: "unassigned", label: "Unassigned" };
}

interface Working {
  key: string;
  label: string;
  items: number;
  wip: number;
  flowLoad: number;
  done: number;
  throughput: number;
  _ageSum: number;
  _ageN: number;
  _ageMax: number;
  agingOver: number;
  _cycleSum: number;
  _cycleN: number;
}

function blank(s: { key: string; label: string }): Working {
  return { key: s.key, label: s.label, items: 0, wip: 0, flowLoad: 0, done: 0, throughput: 0, _ageSum: 0, _ageN: 0, _ageMax: 0, agingOver: 0, _cycleSum: 0, _cycleN: 0 };
}

/**
 * Consolidate every project's work items into per-value-stream flow rows + portfolio totals. Pure and
 * derive-only: the same items + `now` always produce the same roll-up. All day-counts are guarded against
 * unparseable dates (skipped, never surfaced as NaN) and clamped non-negative.
 */
export function rollupValueStreams(projects: ProjectItems[], config: FlowConfig = {}): FlowRollup {
  const now = config.now ?? Date.now();
  const agingThresholdDays = config.agingThresholdDays ?? AGING_THRESHOLD_DAYS;
  const throughputWindowDays = config.throughputWindowDays ?? THROUGHPUT_WINDOW_DAYS;
  const windowStart = now - throughputWindowDays * DAY_MS;

  const map = new Map<string, Working>();
  for (const p of projects) {
    for (const it of p.items as unknown as FlowItem[]) {
      const stream = streamOf(it);
      const w = map.get(stream.key) ?? blank(stream);
      w.items += 1;
      const state = flowState(it.status);

      if (state === "wip") {
        w.wip += 1;
        w.flowLoad += num(it.storyPoints);
        // Age from when the work actually started (startDate), falling back to createdAt.
        const started = parseDateMs(it.startDate) ?? parseDateMs(it.createdAt);
        if (started != null) {
          const age = daysBetween(started, now);
          w._ageSum += age;
          w._ageN += 1;
          if (age > w._ageMax) w._ageMax = age;
          if (age > agingThresholdDays) w.agingOver += 1;
        }
      } else if (state === "done") {
        w.done += 1;
        // Completion proxied by updatedAt; counts toward throughput only if it lands inside the window.
        const finished = parseDateMs(it.updatedAt);
        if (finished != null && finished >= windowStart && finished <= now) w.throughput += 1;
        // Cycle time: created → finished, else the planned span start → due. Only positive, finite spans count.
        const openedC = parseDateMs(it.createdAt);
        const cycle = openedC != null && finished != null
          ? daysBetween(openedC, finished)
          : (() => {
              const s = parseDateMs(it.startDate);
              const d = parseDateMs(it.dueDate);
              return s != null && d != null ? daysBetween(s, d) : null;
            })();
        if (cycle != null) {
          w._cycleSum += cycle;
          w._cycleN += 1;
        }
      }
      map.set(stream.key, w);
    }
  }

  const streams: FlowStreamRow[] = [...map.values()]
    .map((w) => ({
      key: w.key,
      label: w.label,
      items: w.items,
      wip: w.wip,
      flowLoad: round1(w.flowLoad),
      done: w.done,
      throughput: w.throughput,
      meanAge: w._ageN > 0 ? round1(w._ageSum / w._ageN) : null,
      maxAge: w._ageN > 0 ? round1(w._ageMax) : null,
      agingOver: w.agingOver,
      meanCycle: w._cycleN > 0 ? round1(w._cycleSum / w._cycleN) : null,
    }))
    // Most work-in-progress first, so the streams under the most load lead the table.
    .sort((a, b) => b.wip - a.wip || b.items - a.items || a.key.localeCompare(b.key));

  let cycleSum = 0;
  let cycleN = 0;
  for (const w of map.values()) {
    cycleSum += w._cycleSum;
    cycleN += w._cycleN;
  }
  return {
    streams,
    totals: {
      streams: streams.length,
      items: streams.reduce((s, r) => s + r.items, 0),
      wip: streams.reduce((s, r) => s + r.wip, 0),
      throughput: streams.reduce((s, r) => s + r.throughput, 0),
      agingOver: streams.reduce((s, r) => s + r.agingOver, 0),
      meanCycle: cycleN > 0 ? round1(cycleSum / cycleN) : null,
    },
    config: { agingThresholdDays, throughputWindowDays },
  };
}

/** Colour an aging cell: red once it's over threshold, amber as it approaches, muted when fresh/empty. */
function ageTone(age: number | null, threshold: number): string {
  if (age == null) return "text-muted-foreground";
  if (age > threshold) return "text-red-500";
  if (age > threshold / 2) return "text-amber-500";
  return "text-green-600";
}

export function ValueStreamFlow() {
  const { formatNumber } = useT();
  const { projects, loading, isError, error, refetch } = usePortfolioItems();
  const { streams, totals, config } = useMemo(() => rollupValueStreams(projects), [projects]);
  const days = (n: number | null) => (n == null ? "—" : `${formatNumber(n)}d`);

  return (
    <DataState isLoading={loading} isError={isError} error={error} onRetry={() => refetch()} className="min-h-40">
      {streams.length === 0 ? (
        <ReportEmpty testId="value-stream-flow-empty">
          No flow data — work items need a status (and ideally a value stream, start/created and updated dates) to chart WIP, aging, throughput and cycle time.
        </ReportEmpty>
      ) : (
        <div className="space-y-4" data-testid="value-stream-flow">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total WIP" value={formatNumber(totals.wip)} hint={`across ${totals.streams} value stream(s)`} />
            <StatCard label="Mean cycle time" value={totals.meanCycle == null ? "—" : `${formatNumber(totals.meanCycle)}d`} hint="created → done" />
            <StatCard label="Throughput" value={formatNumber(totals.throughput)} hint={`done in last ${config.throughputWindowDays}d`} />
            <StatCard label="Aging WIP" value={formatNumber(totals.agingOver)} hint={`in flight > ${config.agingThresholdDays}d`} />
          </div>
          <ReportTable
            rows={streams}
            rowKey={(s) => s.key}
            rowTestId={(s) => `value-stream-flow-row-${s.key}`}
            size="comfortable"
            columns={[
              { header: "Value stream", cellClassName: "font-bold", cell: (s) => s.label },
              { header: "Items", align: "right", cellClassName: "text-muted-foreground", cell: (s) => s.items },
              { header: "WIP", align: "right", cellClassName: "font-black", cell: (s) => s.wip },
              { header: "Load (pts)", align: "right", cell: (s) => s.flowLoad },
              { header: "Mean age", align: "right", cellClassName: (s) => ageTone(s.meanAge, config.agingThresholdDays), cell: (s) => days(s.meanAge) },
              { header: "Oldest", align: "right", cellClassName: (s) => ageTone(s.maxAge, config.agingThresholdDays), cell: (s) => days(s.maxAge) },
              {
                header: "Aging",
                align: "right",
                testId: (s) => `value-stream-flow-row-${s.key}-aging`,
                cell: (s) => (s.agingOver > 0 ? <Badge tone="bad" className="tabular-nums">{s.agingOver}</Badge> : <span className="text-[11px] text-muted-foreground">—</span>),
              },
              { header: "Throughput", align: "right", cell: (s) => s.throughput },
              { header: "Cycle time", align: "right", cell: (s) => days(s.meanCycle) },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            Work items grouped by value stream (or their first label), ordered by WIP (heaviest load first). Age counts whole days
            from an in-progress item&apos;s start (or creation) to today; throughput is items finished in the last {config.throughputWindowDays} days;
            cycle time is created&nbsp;→&nbsp;done (or the planned start&nbsp;→&nbsp;due span). Unparseable dates are skipped. Derived live; nothing is stored.
          </p>
        </div>
      )}
    </DataState>
  );
}
