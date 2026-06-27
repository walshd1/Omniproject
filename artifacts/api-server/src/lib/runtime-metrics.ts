import type { AnyMetric } from "./metrics";

/**
 * Runtime RED metrics (Rate, Errors, Duration) — the always-available
 * observability signal for a pilot. Unlike the portfolio metrics (which read
 * through to the backend and can fail), these are pure in-process counters, so
 * `/api/metrics` can ALWAYS report request rate, error rate and latency even when
 * the backend is down — which is exactly when you need them.
 *
 * Stateless and bounded: a handful of integer counters + fixed-bucket histograms.
 * Nothing per-entity, no unbounded label cardinality (status is bucketed to its
 * class, broker to success/error), so memory is constant. Reset on restart.
 *
 * Multi-replica: each replica reports its own counters; Prometheus aggregates by
 * summing across scraped replica targets (the standard model — no shared state).
 */

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  return "other";
}

// ── Fixed-bucket cumulative histogram (millisecond latencies) ────────────────
interface Hist {
  boundaries: number[];
  counts: number[]; // per-boundary cumulative (count of observations <= boundary)
  sum: number;
  total: number;
}
function makeHist(boundaries: number[]): Hist {
  return { boundaries, counts: new Array(boundaries.length).fill(0), sum: 0, total: 0 };
}
function observe(h: Hist, ms: number): void {
  const v = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  h.sum += v;
  h.total += 1;
  for (let i = 0; i < h.boundaries.length; i++) {
    if (v <= h.boundaries[i]!) h.counts[i]! += 1;
  }
}
function histMetric(name: string, help: string, h: Hist): AnyMetric {
  return {
    name,
    help,
    type: "histogram",
    buckets: h.boundaries.map((le, i) => ({ le, count: h.counts[i]! })),
    sum: h.sum,
    count: h.total,
  };
}

// ── State ────────────────────────────────────────────────────────────────────
const httpByStatusClass = new Map<string, number>();
let httpErrorsTotal = 0; // 5xx responses
let unhandledErrorsTotal = 0; // errors that reached the error-handler seam
let httpInFlight = 0;
const httpDuration = makeHist([5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000]);

const brokerByResult = new Map<string, number>();
const brokerDuration = makeHist([25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]);

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// ── Recorders (called from middleware / audit / error handler) ───────────────

export function httpRequestStarted(): void {
  httpInFlight += 1;
}

/** Record a completed HTTP request. Call once per response (on finish/close). */
export function recordHttpRequest(statusCode: number, durationMs: number): void {
  if (httpInFlight > 0) httpInFlight -= 1;
  bump(httpByStatusClass, statusClass(statusCode));
  if (statusCode >= 500) httpErrorsTotal += 1;
  observe(httpDuration, durationMs);
}

/** Record a brokered call's outcome + latency (from the audit pipeline). */
export function recordBrokerCall(result: "success" | "error" | undefined, ms: number | undefined): void {
  bump(brokerByResult, result ?? "success");
  observe(brokerDuration, ms ?? 0);
}

/** Count an error that reached the unhandled-error seam (error-handler.ts). */
export function recordUnhandledError(): void {
  unhandledErrorsTotal += 1;
}

/** Snapshot the RED metrics as Prometheus metric descriptors. Always succeeds. */
export function runtimeMetrics(): AnyMetric[] {
  const out: AnyMetric[] = [
    {
      name: "omniproject_http_requests_total",
      help: "HTTP requests by status class",
      type: "counter",
      samples: [...httpByStatusClass.entries()].map(([status, value]) => ({ value, labels: { status } })),
    },
    { name: "omniproject_http_errors_total", help: "HTTP 5xx responses", type: "counter", samples: [{ value: httpErrorsTotal }] },
    { name: "omniproject_unhandled_errors_total", help: "Errors reaching the error-handler seam", type: "counter", samples: [{ value: unhandledErrorsTotal }] },
    { name: "omniproject_http_in_flight", help: "In-flight HTTP requests", type: "gauge", samples: [{ value: httpInFlight }] },
    histMetric("omniproject_http_request_duration_ms", "HTTP request duration (ms)", httpDuration),
    {
      name: "omniproject_broker_requests_total",
      help: "Brokered calls by result",
      type: "counter",
      samples: [...brokerByResult.entries()].map(([result, value]) => ({ value, labels: { result } })),
    },
    histMetric("omniproject_broker_request_duration_ms", "Brokered call duration (ms)", brokerDuration),
  ];
  // Ensure the status/result counters always render at least one series so the
  // metric name exists for Prometheus even before the first request.
  if (httpByStatusClass.size === 0) (out[0] as { samples: unknown[] }).samples = [{ value: 0, labels: { status: "2xx" } }];
  if (brokerByResult.size === 0) (out[5] as { samples: unknown[] }).samples = [{ value: 0, labels: { result: "success" } }];
  return out;
}

/** Test-only reset of all counters. */
export function resetRuntimeMetrics(): void {
  httpByStatusClass.clear();
  brokerByResult.clear();
  httpErrorsTotal = 0;
  unhandledErrorsTotal = 0;
  httpInFlight = 0;
  httpDuration.counts.fill(0); httpDuration.sum = 0; httpDuration.total = 0;
  brokerDuration.counts.fill(0); brokerDuration.sum = 0; brokerDuration.total = 0;
}
