import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { formatPrometheus } from "./metrics";
import {
  runtimeMetrics, recordHttpRequest, recordBrokerCall, recordUnhandledError,
  httpRequestStarted, resetRuntimeMetrics,
} from "./runtime-metrics";

beforeEach(() => resetRuntimeMetrics());

test("RED counters render and the metric names always exist (even before traffic)", () => {
  const text = formatPrometheus(runtimeMetrics());
  assert.match(text, /omniproject_http_requests_total\{status="2xx"\} 0/);
  assert.match(text, /omniproject_broker_requests_total\{result="success"\} 0/);
  assert.match(text, /# TYPE omniproject_http_request_duration_ms histogram/);
});

test("recordHttpRequest tallies by status class, counts 5xx as errors", () => {
  recordHttpRequest(200, 12);
  recordHttpRequest(404, 3);
  recordHttpRequest(503, 8);
  const text = formatPrometheus(runtimeMetrics());
  assert.match(text, /omniproject_http_requests_total\{status="2xx"\} 1/);
  assert.match(text, /omniproject_http_requests_total\{status="4xx"\} 1/);
  assert.match(text, /omniproject_http_requests_total\{status="5xx"\} 1/);
  assert.match(text, /omniproject_http_errors_total 1/); // only the 503
});

test("in-flight gauge rises on start and falls on completion", () => {
  httpRequestStarted();
  httpRequestStarted();
  assert.match(formatPrometheus(runtimeMetrics()), /omniproject_http_in_flight 2/);
  recordHttpRequest(200, 1);
  assert.match(formatPrometheus(runtimeMetrics()), /omniproject_http_in_flight 1/);
});

test("the duration histogram has cumulative buckets, sum and count", () => {
  recordHttpRequest(200, 7);   // <= 10
  recordHttpRequest(200, 300); // <= 500
  const text = formatPrometheus(runtimeMetrics());
  // 7ms falls in the le=10 bucket; both observations are <= 500.
  assert.match(text, /omniproject_http_request_duration_ms_bucket\{le="10"\} 1/);
  assert.match(text, /omniproject_http_request_duration_ms_bucket\{le="500"\} 2/);
  assert.match(text, /omniproject_http_request_duration_ms_bucket\{le="\+Inf"\} 2/);
  assert.match(text, /omniproject_http_request_duration_ms_sum 307/);
  assert.match(text, /omniproject_http_request_duration_ms_count 2/);
});

test("broker calls tally by result and feed the broker latency histogram", () => {
  recordBrokerCall("success", 40);
  recordBrokerCall("error", 1200);
  const text = formatPrometheus(runtimeMetrics());
  assert.match(text, /omniproject_broker_requests_total\{result="success"\} 1/);
  assert.match(text, /omniproject_broker_requests_total\{result="error"\} 1/);
  assert.match(text, /omniproject_broker_request_duration_ms_count 2/);
});

test("unhandled errors are counted", () => {
  recordUnhandledError();
  recordUnhandledError();
  assert.match(formatPrometheus(runtimeMetrics()), /omniproject_unhandled_errors_total 2/);
});
