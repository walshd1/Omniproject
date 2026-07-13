import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { parseTraceparent, formatTraceparent, currentTraceparent, tracingMiddleware } from "./tracing";
import { __setEgressTransportForTest } from "./egress";
// Pre-warm the residency module so egress's first-call lazy import of it (added to break a module-init
// cycle) resolves from cache — otherwise this fire-and-forget export can outrun the flush window.
import "./data-residency";

// The exporter now uses lib/egress safeFetch (undici, not global fetch), so intercept via the egress
// transport seam. The OTLP endpoint below is a loopback IP literal, so no DNS/lookup seam is needed.
const ENV_KEYS = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
afterEach(() => {
  __setEgressTransportForTest(null);
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
});

/** A minimal fake req/res pair — just enough of the Express shape tracingMiddleware touches. */
function fakeReqRes(): { req: Request; res: Response; finish: () => void } {
  let finishCb: (() => void) | undefined;
  const headers: Record<string, string> = {};
  const req = { headers: {}, method: "GET", path: "/api/projects" } as unknown as Request;
  const res = {
    statusCode: 200,
    setHeader(k: string, v: string) { headers[k] = v; },
    on(event: string, cb: () => void) { if (event === "finish") finishCb = cb; },
  } as unknown as Response;
  return { req, res, finish: () => finishCb?.() };
}

/** Let a fire-and-forget async export (kicked off inside a "finish" handler, never awaited by the
 *  caller) settle before the test asserts on its side effects (same pattern as audit-sink.test.ts).
 *  Drains several macrotasks so the export's async chain — which includes egress's first-call lazy
 *  import of the residency module — has fully completed. */
async function flush(): Promise<void> { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); }

/**
 * W3C trace context parsing/formatting + AsyncLocalStorage propagation.
 */
test("parseTraceparent accepts a valid header and rejects malformed/zero ones", () => {
  const tp = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  const parsed = parseTraceparent(tp);
  assert.equal(parsed?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(parsed?.spanId, "00f067aa0ba902b7");
  assert.equal(parsed?.sampled, true);

  assert.equal(parseTraceparent(undefined), null);
  assert.equal(parseTraceparent("garbage"), null);
  // all-zero trace id is invalid per spec
  assert.equal(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), null);
  // not-sampled flag
  assert.equal(parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")?.sampled, false);
});

test("formatTraceparent round-trips through parseTraceparent", () => {
  const tp = formatTraceparent("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", true);
  assert.equal(tp, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  const parsed = parseTraceparent(tp);
  assert.equal(parsed?.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
});

test("currentTraceparent is null outside a request context", () => {
  assert.equal(currentTraceparent(), null);
});

test("tracingMiddleware does not export a span when no OTLP endpoint is configured", async () => {
  delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  let called = false;
  __setEgressTransportForTest((async () => { called = true; return new Response(null, { status: 200 }); }) as unknown as typeof fetch);

  const { req, res, finish } = fakeReqRes();
  tracingMiddleware(req, res, (() => {}) as NextFunction);
  finish();
  await flush();
  assert.equal(called, false);
});

test("tracingMiddleware exports a span to the OTLP endpoint on response finish", async () => {
  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:4318";
  const calls: Array<{ url: string; body: any }> = [];
  __setEgressTransportForTest((async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch);

  const { req, res, finish } = fakeReqRes();
  tracingMiddleware(req, res, (() => {}) as NextFunction);
  finish();
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://127.0.0.1:4318/v1/traces");
  const span = calls[0]!.body.resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(span.name, "GET /api/projects");
  assert.equal(span.status.code, 1); // 200 -> OK
  assert.match(span.traceId, /^[0-9a-f]{32}$/);
});

test("tracingMiddleware's export is best-effort — a fetch rejection never throws", async () => {
  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:4318";
  __setEgressTransportForTest((async () => { throw new Error("connection refused"); }) as unknown as typeof fetch);

  const { req, res, finish } = fakeReqRes();
  assert.doesNotThrow(() => {
    tracingMiddleware(req, res, (() => {}) as NextFunction);
    finish();
  });
  await flush(); // let the rejected promise settle+log without an unhandled-rejection
});
