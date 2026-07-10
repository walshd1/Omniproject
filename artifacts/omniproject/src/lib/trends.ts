import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Trend client — reads the durable time-series the retention layer keeps (history/*). When no
 * retention source is configured (or the history domain is off for the scope) the series comes back
 * `available: false` with a reason, so the UI shows an honest "history not yet retained" note rather
 * than a fabricated chart. See docs/HISTORY-RETENTION.md.
 */
export type TrendGrain = "day" | "week" | "month" | "quarter";

export type TrendMetric =
  | "completionPct"
  | "openBlockers"
  | "cpi"
  | "spi"
  | "estimateAtCompletion"
  | "costVariance"
  | "scheduleVariance"
  | "benefitRealisedPct"
  | "openRisks"
  | "cycleTimeDays"
  | "throughput";

export interface TrendPoint {
  at: string;
  value: number | null;
  n: number;
  provenance: string;
}

export interface TrendSeries {
  metric: TrendMetric;
  grain: TrendGrain;
  from: string;
  to: string;
  points: TrendPoint[];
  available: boolean;
  reason?: string;
}

export interface TrendQuery {
  metric: TrendMetric;
  grain?: TrendGrain;
  programmeId?: string | null;
  projectId?: string | null;
  entity?: string;
  ids?: string[];
  from?: string;
  to?: string;
}

function trendUrl(q: TrendQuery): string {
  const p = new URLSearchParams();
  if (q.grain) p.set("grain", q.grain);
  if (q.programmeId) p.set("programmeId", q.programmeId);
  if (q.projectId) p.set("projectId", q.projectId);
  if (q.entity) p.set("entity", q.entity);
  if (q.ids && q.ids.length) p.set("ids", q.ids.join(","));
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  const s = p.toString();
  return `/api/history/trends/${encodeURIComponent(q.metric)}${s ? `?${s}` : ""}`;
}

export const trendQueryKey = (q: TrendQuery) =>
  ["trend", q.metric, q.grain ?? "month", q.programmeId ?? null, q.projectId ?? null] as const;

/** Fetch a trend series for a metric. `enabled` gates the request (e.g. only when a scope is chosen). */
export function useTrend(q: TrendQuery, enabled = true) {
  return useQuery({
    queryKey: trendQueryKey(q),
    queryFn: () => getJson<TrendSeries>(trendUrl(q)),
    enabled,
    staleTime: 30_000,
  });
}
