import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { AnyMetric } from "./metrics";
import {
  coreMetrics, cacheMetrics, toOtlpMetricsPayload, otlpMetricsEndpoint,
  metricExportIntervalMs, startMetricExport, stopMetricExport,
} from "./otlp-metrics";

const ENV_KEYS = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_METRIC_EXPORT_INTERVAL"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterEach(() => { stopMetricExport(); for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; } });

test("cacheMetrics exposes hit/miss counter + enabled gauge", () => {
  const names = cacheMetrics().map((m) => m.name);
  assert.ok(names.includes("omniproject_read_cache_events_total"));
  assert.ok(names.includes("omniproject_read_cache_enabled"));
});

test("coreMetrics folds runtime RED + cache metrics into one set", () => {
  const names = coreMetrics().map((m) => m.name);
  assert.ok(names.includes("omniproject_http_requests_total"));
  assert.ok(names.includes("omniproject_read_cache_events_total"));
});

test("gauge → OTLP gauge, counter → monotonic cumulative sum", () => {
  const metrics: AnyMetric[] = [
    { name: "g", help: "gauge", type: "gauge", samples: [{ value: 3 }] },
    { name: "c", help: "counter", type: "counter", samples: [{ value: 7, labels: { status: "2xx" } }] },
  ];
  const payload = toOtlpMetricsPayload(metrics, { serviceName: "svc", nowNs: 1000n }) as any;
  const out = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(out[0].gauge.dataPoints[0].asDouble, 3);
  assert.equal(out[1].sum.isMonotonic, true);
  assert.equal(out[1].sum.aggregationTemporality, 2);
  assert.equal(out[1].sum.dataPoints[0].attributes[0].value.stringValue, "2xx");
  assert.equal(payload.resourceMetrics[0].resource.attributes[0].value.stringValue, "svc");
});

test("histogram cumulative buckets convert to per-bucket counts + implicit +Inf", () => {
  const metrics: AnyMetric[] = [
    { name: "h", help: "hist", type: "histogram", buckets: [{ le: 5, count: 2 }, { le: 10, count: 5 }], sum: 42, count: 6 },
  ];
  const payload = toOtlpMetricsPayload(metrics, { serviceName: "svc", nowNs: 1n }) as any;
  const dp = payload.resourceMetrics[0].scopeMetrics[0].metrics[0].histogram.dataPoints[0];
  // cumulative [2,5] with total 6 → per-bucket [2, 3, 1] (last is +Inf)
  assert.deepEqual(dp.bucketCounts, [2, 3, 1]);
  assert.deepEqual(dp.explicitBounds, [5, 10]);
  assert.equal(dp.count, 6);
  assert.equal(dp.sum, 42);
  assert.equal(dp.bucketCounts.length, dp.explicitBounds.length + 1);
});

test("endpoint + export are OFF by default and derive …/v1/metrics when set", () => {
  delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  assert.equal(otlpMetricsEndpoint(), null);
  assert.equal(startMetricExport(), false); // no-op without an endpoint

  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://collector:4318/";
  assert.equal(otlpMetricsEndpoint(), "http://collector:4318/v1/metrics");
  assert.equal(startMetricExport(), true);
  assert.equal(startMetricExport(), false); // idempotent — already running
});

test("interval defaults to 60s and clamps to a 1s floor", () => {
  delete process.env["OTEL_METRIC_EXPORT_INTERVAL"];
  assert.equal(metricExportIntervalMs(), 60_000);
  process.env["OTEL_METRIC_EXPORT_INTERVAL"] = "100";
  assert.equal(metricExportIntervalMs(), 1_000);
  process.env["OTEL_METRIC_EXPORT_INTERVAL"] = "5000";
  assert.equal(metricExportIntervalMs(), 5_000);
});
