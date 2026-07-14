/**
 * Pure series builders for the progress-plane reports (burndown / burnup / cumulative-flow /
 * velocity). They consume the backend's project history (`get_project_history`) — OmniProject keeps
 * no history of its own — so every series is a derive-only transform with nothing stored. Each builder
 * is total/completed-based (the two counts the history contract guarantees), so it works against any
 * backend that can answer history, not just ones that emit per-status time series.
 */

import { numLoose } from "./num";

/** One history sample as returned by the broker (only the fields these charts need). The generated
 *  client types `date` as `Date`, but the wire value is an ISO string — accept both and coerce. */
export interface HistoryPoint {
  date: string | Date;
  totalIssues: number;
  completedIssues: number;
}

const dateOf = (p: HistoryPoint): string => String(p.date);

export interface BurndownPoint { date: string; remaining: number; ideal: number }
export interface BurnupPoint { date: string; completed: number; scope: number }
export interface FlowPoint { date: string; completed: number; remaining: number }
export interface VelocityPoint { period: string; completed: number }

const remainingOf = (p: HistoryPoint): number => Math.max(0, numLoose(p.totalIssues) - numLoose(p.completedIssues));

/**
 * Burndown: remaining work per sample against the ideal straight line from the starting remaining
 * down to zero across the window. A single sample yields a flat ideal (no slope to draw).
 */
export function burndownSeries(history: readonly HistoryPoint[]): BurndownPoint[] {
  if (history.length === 0) return [];
  const start = remainingOf(history[0]!);
  const last = history.length - 1;
  return history.map((p, i) => ({
    date: dateOf(p),
    remaining: remainingOf(p),
    ideal: last === 0 ? start : Math.round(start * (1 - i / last)),
  }));
}

/** Burnup: completed work rising toward the (possibly moving) total scope line. */
export function burnupSeries(history: readonly HistoryPoint[]): BurnupPoint[] {
  return history.map((p) => ({ date: dateOf(p), completed: numLoose(p.completedIssues), scope: numLoose(p.totalIssues) }));
}

/** Cumulative flow: the completed vs still-remaining bands stacked over time (the two-band CFD a
 *  total/completed history supports; a per-status history would add more bands the same way). */
export function cumulativeFlowSeries(history: readonly HistoryPoint[]): FlowPoint[] {
  return history.map((p) => ({ date: dateOf(p), completed: numLoose(p.completedIssues), remaining: remainingOf(p) }));
}

/** Velocity / throughput: work completed in each period (the positive delta of completed count
 *  between consecutive samples). Needs ≥2 samples to have a delta; clamps negatives (re-opened work)
 *  to zero so a period never reads as negative throughput. */
export function velocitySeries(history: readonly HistoryPoint[]): VelocityPoint[] {
  const out: VelocityPoint[] = [];
  for (let i = 1; i < history.length; i++) {
    const delta = numLoose(history[i]!.completedIssues) - numLoose(history[i - 1]!.completedIssues);
    out.push({ period: dateOf(history[i]!), completed: Math.max(0, delta) });
  }
  return out;
}

/** Mean throughput across the velocity series (for the summary line). */
export function meanVelocity(series: readonly VelocityPoint[]): number {
  if (series.length === 0) return 0;
  return Math.round((series.reduce((s, p) => s + p.completed, 0) / series.length) * 10) / 10;
}
