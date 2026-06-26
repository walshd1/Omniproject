/**
 * Load-harness core — pure, so the stats, error classification, concurrency pool
 * and pass/fail verdict are unit-tested and shared. The CLI (load-harness.ts)
 * wires these to real HTTP against the gateway; this file does no I/O.
 */

export type ResultCategory = "ok" | "client_error" | "server_error" | "network";

/** Bucket an HTTP status (or null for a network/timeout failure) by what an
 *  operator actually needs to triage — 4xx (our fault / auth) vs 5xx (backend
 *  blew up) vs no-response (timeout / socket). */
export function classifyStatus(status: number | null | undefined): ResultCategory {
  if (status == null) return "network";
  if (status >= 200 && status < 400) return "ok";
  if (status >= 400 && status < 500) return "client_error";
  return "server_error";
}

/** Nearest-rank percentile over an ascending-sorted array (ms). */
export function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, rank - 1));
  return sortedAsc[idx]!;
}

export interface LatencySummary {
  count: number;
  min: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export function summarise(latencies: ReadonlyArray<number>): LatencySummary {
  if (latencies.length === 0) return { count: 0, min: 0, mean: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((s, n) => s + n, 0);
  return {
    count: sorted.length,
    min: sorted[0]!,
    mean: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1]!,
  };
}

export interface OpReport {
  op: string;
  latency: LatencySummary;
  categories: Record<ResultCategory, number>;
  errorRate: number; // non-ok / total
}

export interface LoadReport {
  ops: OpReport[];
  overall: OpReport;
  total: number;
}

const ZERO_CATS = (): Record<ResultCategory, number> => ({ ok: 0, client_error: 0, server_error: 0, network: 0 });

/** Accumulates per-operation latencies + outcome categories, then folds them
 *  into a structured report (per-op + overall). */
export class Recorder {
  private readonly lat = new Map<string, number[]>();
  private readonly cats = new Map<string, Record<ResultCategory, number>>();

  record(op: string, ms: number, category: ResultCategory): void {
    if (!this.lat.has(op)) {
      this.lat.set(op, []);
      this.cats.set(op, ZERO_CATS());
    }
    this.lat.get(op)!.push(ms);
    this.cats.get(op)![category] += 1;
  }

  private opReport(op: string, lat: ReadonlyArray<number>, cats: Record<ResultCategory, number>): OpReport {
    const total = cats.ok + cats.client_error + cats.server_error + cats.network;
    return { op, latency: summarise(lat), categories: cats, errorRate: total ? (total - cats.ok) / total : 0 };
  }

  report(): LoadReport {
    const ops = [...this.lat.keys()].sort().map((op) => this.opReport(op, this.lat.get(op)!, this.cats.get(op)!));
    const allLat: number[] = [];
    const allCats = ZERO_CATS();
    for (const op of this.lat.keys()) {
      allLat.push(...this.lat.get(op)!);
      const c = this.cats.get(op)!;
      allCats.ok += c.ok; allCats.client_error += c.client_error;
      allCats.server_error += c.server_error; allCats.network += c.network;
    }
    return { ops, overall: this.opReport("overall", allLat, allCats), total: allLat.length };
  }
}

export interface Thresholds {
  maxErrorRate: number; // e.g. 0.01
  maxP99Ms?: number; // optional latency budget
}

export interface Verdict {
  pass: boolean;
  reasons: string[];
}

/** Pass/fail a report against thresholds, with human-readable reasons on failure. */
export function verdict(report: LoadReport, t: Thresholds): Verdict {
  const reasons: string[] = [];
  if (report.total === 0) reasons.push("no requests were recorded");
  if (report.overall.errorRate > t.maxErrorRate) {
    reasons.push(`error rate ${(report.overall.errorRate * 100).toFixed(2)}% exceeds ${(t.maxErrorRate * 100).toFixed(2)}%`);
  }
  if (t.maxP99Ms != null && report.overall.latency.p99 > t.maxP99Ms) {
    reasons.push(`p99 ${report.overall.latency.p99}ms exceeds ${t.maxP99Ms}ms`);
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * Run an array of async thunks at most `concurrency` in flight — the standard
 * worker-pool. Returns when every thunk has settled; a thunk that throws is
 * swallowed (the thunk itself is expected to record the failure).
 */
export async function runPool(thunks: ReadonlyArray<() => Promise<void>>, concurrency: number): Promise<void> {
  let next = 0;
  const n = Math.max(1, Math.min(Math.floor(concurrency) || 1, thunks.length));
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= thunks.length) return;
      try {
        await thunks[i]!();
      } catch {
        /* the thunk records its own outcome; never let one task kill the pool */
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
}
