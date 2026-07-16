import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { logger } from "./logger";
import { safeFetch } from "./egress";

/**
 * Distributed tracing via W3C Trace Context — no OTel SDK, just the wire format + a minimal
 * OTLP/HTTP exporter. Each request:
 *   - continues the incoming `traceparent` (or starts a new trace), minting a fresh server span;
 *   - exposes `traceId` / `requestId` on `req` and the request logger (log↔trace correlation);
 *   - echoes `traceparent` + `x-request-id` response headers;
 *   - propagates the context through async work via AsyncLocalStorage, so the broker egress
 *     can forward `traceparent` downstream (one trace across the gateway→broker hop);
 *   - on completion, exports a span to an OTLP collector when OTEL_EXPORTER_OTLP_ENDPOINT is
 *     set (Datadog / Jaeger / Honeycomb / Tempo …) — best-effort, never blocking the response.
 */
export interface TraceContext { traceId: string; spanId: string; parentSpanId: string | null; sampled: boolean }

const als = new AsyncLocalStorage<TraceContext>();

const newTraceId = (): string => crypto.randomBytes(16).toString("hex");
const newSpanId = (): string => crypto.randomBytes(8).toString("hex");

/** Parse a W3C `traceparent` header, or null if absent/malformed. */
export function parseTraceparent(header: string | undefined): { traceId: string; spanId: string; sampled: boolean } | null {
  if (!header) return null;
  const m = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})$/i.exec(header.trim());
  if (!m) return null;
  if (m[2] === "0".repeat(32) || m[3] === "0".repeat(16)) return null; // all-zero ids are invalid
  return { traceId: m[2]!.toLowerCase(), spanId: m[3]!.toLowerCase(), sampled: (parseInt(m[4]!, 16) & 1) === 1 };
}

/** Format a `traceparent` for the given trace + span. */
export function formatTraceparent(traceId: string, spanId: string, sampled: boolean): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

/** The current request's `traceparent` (for downstream propagation), or null outside a request. */
export function currentTraceparent(): string | null {
  const ctx = als.getStore();
  return ctx ? formatTraceparent(ctx.traceId, ctx.spanId, ctx.sampled) : null;
}

/** The active trace context, or null. */
export function currentTrace(): TraceContext | null {
  return als.getStore() ?? null;
}

function otlpEndpoint(): string | null {
  const base = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"]?.trim();
  return base ? `${base.replace(/\/$/, "")}/v1/traces` : null;
}

// In-flight best-effort exports. Each `finish`-handler export is fire-and-forget w.r.t. the response (it
// must never block it), but we still TRACK the promise so it can be awaited deterministically — on graceful
// shutdown (don't drop the last spans) and in tests (assert on the export without racing a macrotask drain).
const pendingExports = new Set<Promise<void>>();

/** Await every in-flight span export to settle. Used by graceful shutdown to flush pending telemetry, and
 *  by tests to await the fire-and-forget export deterministically. Never rejects (exports are best-effort). */
export async function flushSpanExports(): Promise<void> {
  await Promise.allSettled([...pendingExports]);
}

/** Best-effort OTLP/HTTP span export (JSON). Swallows errors; never blocks the request. */
async function exportSpan(span: { ctx: TraceContext; name: string; startNs: number; endNs: number; status: number; attrs: Record<string, string | number> }): Promise<void> {
  const url = otlpEndpoint();
  if (!url) return;
  const serviceName = process.env["OTEL_SERVICE_NAME"]?.trim() || "omniproject-gateway";
  const attributes = Object.entries(span.attrs).map(([k, v]) => ({
    key: k,
    value: typeof v === "number" ? { intValue: v } : { stringValue: String(v) },
  }));
  const body = {
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: serviceName } }] },
      scopeSpans: [{
        scope: { name: "omniproject" },
        spans: [{
          traceId: span.ctx.traceId,
          spanId: span.ctx.spanId,
          parentSpanId: span.ctx.parentSpanId ?? undefined,
          name: span.name,
          kind: 2, // SERVER
          startTimeUnixNano: String(span.startNs),
          endTimeUnixNano: String(span.endNs),
          attributes,
          status: { code: span.status >= 500 ? 2 : 1 }, // ERROR : OK
        }],
      }],
    }],
  };
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const hdr = process.env["OTEL_EXPORTER_OTLP_HEADERS"]?.trim();
    if (hdr) for (const pair of hdr.split(",")) { const i = pair.indexOf("="); if (i > 0) headers[pair.slice(0, i).trim()] = pair.slice(i + 1).trim(); }
    // Telemetry egress goes through safeFetch, not a bare fetch after a one-shot check: it applies the
    // SAME SSRF/residency guard AND pins the vetted IPs + re-validates every redirect Location — so a
    // collector can't 302 the exporter to http://169.254.169.254/… and exfiltrate IAM creds with the
    // OTLP auth headers attached (docs/DATA-RESIDENCY.md sells this as covering "every outbound request").
    // Fails closed under an active residency policy / EGRESS_ALLOWLIST; the catch turns that into a drop.
    await safeFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    logger.debug({ err }, "otlp span export failed");
  }
}

/** Express middleware: establish/continue the trace, correlate the logger, propagate, export. */
export function tracingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = parseTraceparent(req.headers["traceparent"] as string | undefined);
  const ctx: TraceContext = {
    traceId: incoming?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: incoming?.spanId ?? null,
    sampled: incoming?.sampled ?? true,
  };
  const requestId = (req as { id?: string }).id?.toString() || ctx.traceId;
  (req as { traceId?: string }).traceId = ctx.traceId;
  (req as { requestId?: string }).requestId = requestId;

  // Correlate logs with the trace (so a log line links to its span).
  if (req.log) req.log = req.log.child({ traceId: ctx.traceId, requestId, spanId: ctx.spanId });

  res.setHeader("traceparent", formatTraceparent(ctx.traceId, ctx.spanId, ctx.sampled));
  res.setHeader("x-request-id", requestId);

  const startNs = Date.now() * 1e6;
  const startHr = process.hrtime.bigint();
  res.on("finish", () => {
    const endNs = startNs + Number(process.hrtime.bigint() - startHr);
    // Fire-and-forget w.r.t. the response, but tracked so flushSpanExports() can await it (shutdown / tests).
    const p = exportSpan({
      ctx,
      name: `${req.method} ${(req as { route?: { path?: string } }).route?.path ?? req.path}`,
      startNs, endNs,
      status: res.statusCode,
      attrs: { "http.method": req.method, "http.route": req.path, "http.status_code": res.statusCode },
    });
    pendingExports.add(p);
    void p.finally(() => pendingExports.delete(p));
  });

  als.run(ctx, () => next());
}
