import { runtimeMetrics } from "./runtime-metrics";
import { readCacheStats } from "../broker/cache";
import type { AnyMetric } from "./metrics";
import { logger } from "./logger";
import { envInt } from "./env-config";
import { safeFetch } from "./egress";

/**
 * OTLP/HTTP metrics export — the metrics counterpart to lib/tracing's span export. The same
 * always-available in-process signals that `/api/metrics` renders in Prometheus text
 * (RED request counters/latency, broker-call latency, cache hit/miss) are additionally PUSHED
 * to an OTLP collector on a fixed interval, so a Datadog / Grafana-Agent / OTel-Collector
 * pipeline gets real metrics without running a Prometheus scrape.
 *
 * Off by default and fully additive: nothing starts unless OTEL_EXPORTER_OTLP_ENDPOINT is set
 * (the same gate the span exporter uses). No SDK — just the OTLP/HTTP JSON wire format over
 * fetch, best-effort, never throwing into the app.
 */

/** Cache hit/miss + enabled state as Prometheus-shaped metrics (folded into the core set). */
export function cacheMetrics(): AnyMetric[] {
  const s = readCacheStats();
  return [
    {
      name: "omniproject_read_cache_events_total",
      help: "Read-cache lookups by outcome",
      type: "counter",
      samples: [
        { value: s.hits, labels: { result: "hit" } },
        { value: s.misses, labels: { result: "miss" } },
      ],
    },
    { name: "omniproject_read_cache_enabled", help: "Read cache active (1) or off (0)", type: "gauge", samples: [{ value: s.enabled ? 1 : 0 }] },
  ];
}

/** The full in-process metric set (RED + broker latency + cache) — shared by the scrape route and the OTLP push. */
export function coreMetrics(): AnyMetric[] {
  return [...runtimeMetrics(), ...cacheMetrics()];
}

/** The OTLP metrics endpoint (…/v1/metrics), or null when export is not configured. */
export function otlpMetricsEndpoint(): string | null {
  const base = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim();
  return base ? `${base.replace(/\/$/, "")}/v1/metrics` : null;
}

/** Parse OTEL_EXPORTER_OTLP_HEADERS ("k=v,k2=v2") into a header map (shared shape with the span exporter). */
function otlpHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const hdr = process.env["OTEL_EXPORTER_OTLP_HEADERS"]?.trim();
  if (hdr) for (const pair of hdr.split(",")) { const i = pair.indexOf("="); if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
  return headers;
}

// Cumulative-since-process-start is the correct OTLP temporality for these counters/histograms.
const AGG_CUMULATIVE = 2;

interface OtlpDataPoint { attributes: { key: string; value: { stringValue: string } }[]; timeUnixNano: string; asDouble: number }

function attrs(labels?: Record<string, string>): { key: string; value: { stringValue: string } }[] {
  return Object.entries(labels ?? {}).map(([key, v]) => ({ key, value: { stringValue: String(v) } }));
}

/** Convert one Prometheus-shaped metric to its OTLP metric object (gauge / monotonic sum / histogram). */
function toOtlpMetric(m: AnyMetric, nowNs: string): Record<string, unknown> {
  if (m.type === "histogram") {
    // Prometheus buckets are CUMULATIVE (count of observations ≤ le); OTLP wants per-bucket counts
    // with an implicit +Inf bucket, so length === explicitBounds.length + 1.
    const bounds = m.buckets.map((b) => b.le);
    const bucketCounts: number[] = [];
    let prev = 0;
    for (const b of m.buckets) { bucketCounts.push(Math.max(0, b.count - prev)); prev = b.count; }
    bucketCounts.push(Math.max(0, m.count - prev)); // +Inf bucket
    return {
      name: m.name,
      description: m.help,
      unit: "ms",
      histogram: {
        aggregationTemporality: AGG_CUMULATIVE,
        dataPoints: [{ attributes: attrs(m.labels), startTimeUnixNano: nowNs, timeUnixNano: nowNs, count: m.count, sum: m.sum, bucketCounts, explicitBounds: bounds }],
      },
    };
  }
  const dataPoints: OtlpDataPoint[] = m.samples.map((s) => ({ attributes: attrs(s.labels), timeUnixNano: nowNs, asDouble: s.value }));
  if (m.type === "counter") {
    return { name: m.name, description: m.help, sum: { aggregationTemporality: AGG_CUMULATIVE, isMonotonic: true, dataPoints: dataPoints.map((d) => ({ ...d, startTimeUnixNano: nowNs })) } };
  }
  return { name: m.name, description: m.help, gauge: { dataPoints } };
}

/** Build the OTLP/HTTP `resourceMetrics` payload for a metric set. Pure + exported for unit tests. */
export function toOtlpMetricsPayload(metrics: AnyMetric[], opts: { serviceName: string; nowNs?: bigint }): Record<string, unknown> {
  const nowNs = String(opts.nowNs ?? BigInt(Date.now()) * 1_000_000n);
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: opts.serviceName } }] },
      scopeMetrics: [{ scope: { name: "omniproject" }, metrics: metrics.map((m) => toOtlpMetric(m, nowNs)) }],
    }],
  };
}

/** Push the current core metric set to the OTLP collector once. Best-effort; swallows errors. */
export async function exportMetricsOnce(): Promise<void> {
  const url = otlpMetricsEndpoint();
  if (!url) return;
  const serviceName = process.env["OTEL_SERVICE_NAME"]?.trim() || "omniproject-gateway";
  const body = toOtlpMetricsPayload(coreMetrics(), { serviceName });
  try {
    // Same egress/residency guard as every other outbound hop, via safeFetch — which also pins the
    // vetted IPs and re-validates each redirect Location, so a collector can't 302 the exporter into
    // the cloud metadata endpoint (see docs/DATA-RESIDENCY.md and lib/egress.ts).
    await safeFetch(url, { method: "POST", headers: otlpHeaders(), body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    logger.debug({ err }, "otlp metrics export failed");
  }
}

/** The export interval (ms) from OTEL_METRIC_EXPORT_INTERVAL, clamped to a sane floor; default 60s. */
export function metricExportIntervalMs(): number {
  return Math.max(1_000, envInt("OTEL_METRIC_EXPORT_INTERVAL", 60_000, { min: 1 }));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic OTLP metrics push. No-op (returns false) unless an OTLP endpoint is configured. */
export function startMetricExport(): boolean {
  if (timer || !otlpMetricsEndpoint()) return false;
  const interval = metricExportIntervalMs();
  timer = setInterval(() => { void exportMetricsOnce(); }, interval);
  // Don't hold the event loop open on shutdown — the exporter is fire-and-forget.
  if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
  logger.info({ endpoint: otlpMetricsEndpoint(), intervalMs: interval }, "otlp metrics export ON");
  return true;
}

/** Stop the periodic OTLP metrics push (idempotent). */
export function stopMetricExport(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
