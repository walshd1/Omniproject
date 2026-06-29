/**
 * Performance instrumentation helpers (pure) for the dev-mode timing overlay.
 *
 * The product's adoption bar is "what the customer wants in 2 clicks and under 1s",
 * so devs need to SEE where the time goes: initial load (TTFB → DOMContentLoaded →
 * load), per-API latency split into gateway vs upstream (from the Server-Timing header
 * the gateway emits), and route-switch responsiveness. This module turns the browser's
 * Performance API into those numbers; the overlay just renders them.
 */

export interface NavTiming {
  /** Time to first byte of the document. */
  ttfbMs: number;
  /** DOMContentLoaded — the app's HTML+CSS are parsed. */
  domContentLoadedMs: number;
  /** Load — everything (including the initial JS) is in. */
  loadMs: number;
}

export interface ApiSample {
  url: string;
  /** Browser-observed total (network + server). */
  durationMs: number;
  /** Server-Timing: time the gateway waited on the broker/backend. */
  upstreamMs: number;
  /** Server-Timing: the gateway's own overhead. */
  gatewayMs: number;
}

export interface Stat {
  count: number;
  p50: number;
  p95: number;
  max: number;
  avg: number;
}

/** Read the document's navigation timing, or null when unavailable. */
export function readNavigationTiming(): NavTiming | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (!nav) return null;
  return {
    ttfbMs: Math.round(nav.responseStart),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
    loadMs: Math.round(nav.loadEventEnd || nav.duration),
  };
}

/** Pull the gateway/upstream/total split out of a resource entry's Server-Timing. */
export function parseServerTiming(
  serverTiming: ReadonlyArray<{ name: string; duration: number }> | undefined,
): { upstreamMs: number; gatewayMs: number; totalMs: number } {
  const dur = (name: string): number => Math.round(serverTiming?.find((e) => e.name === name)?.duration ?? 0);
  return { upstreamMs: dur("upstream"), gatewayMs: dur("gateway"), totalMs: dur("total") };
}

/** Build an ApiSample from a resource timing entry (null if it isn't an API call). */
export function toApiSample(entry: PerformanceResourceTiming): ApiSample | null {
  if (!entry.name.includes("/api/")) return null;
  const { upstreamMs, gatewayMs } = parseServerTiming(entry.serverTiming);
  return {
    url: new URL(entry.name, "http://x").pathname,
    durationMs: Math.round(entry.duration),
    upstreamMs,
    gatewayMs,
  };
}

/** The q-th percentile (0..1) of an already-sorted ascending array. */
export function quantile(sortedAsc: readonly number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(q * sortedAsc.length));
  return sortedAsc[idx]!; // idx is clamped to a valid index and length > 0 here
}

/** Summarise a set of samples (count, p50, p95, max, mean). */
export function summarise(samples: readonly number[]): Stat {
  if (samples.length === 0) return { count: 0, p50: 0, p95: 0, max: 0, avg: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1]!, // samples.length > 0 checked above
    avg: Math.round(sum / sorted.length),
  };
}

/** Append to a fixed-capacity ring buffer, returning a new array (React-friendly). */
export function pushCapped<T>(buffer: readonly T[], item: T, capacity = 50): T[] {
  const start = buffer.length >= capacity ? buffer.length - capacity + 1 : 0;
  return [...buffer.slice(start), item];
}
