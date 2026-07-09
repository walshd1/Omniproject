import type { Request } from "express";
import { logger } from "./logger";
import { pushBrokerEvent } from "./broker-log";
import { recordBrokerCall } from "./runtime-metrics";
import { sealAuditEvent, sealAuditEventShared } from "./audit-chain";
import { sharedStateMode } from "./shared-state";
import { getSession } from "../routes/auth";
import { roleForReq } from "./rbac";

/**
 * Action audit logging.
 *
 * Stateless: OmniProject does not retain logs. It emits a structured audit event
 * per action to stdout (pino) and — when AUDIT_HTTP_URL is set — ships them to an
 * external logging server (Loki / Splunk HEC / Elastic / a syslog-over-HTTP
 * collector). Delivery is best-effort and in-memory buffered; nothing is written
 * to disk, so for guaranteed retention point AUDIT_HTTP_URL at a durable sink.
 *
 * Scope is configurable (full logging of all actions, or a subset):
 *   AUDIT_LEVEL = off | writes | all   (default "writes")
 *     off    — disable auditing
 *     writes — mutations + auth + admin/config + brokered writes
 *     all    — every request (incl. reads) + every brokered action
 *
 * External sink env:
 *   AUDIT_HTTP_URL    — POST endpoint for batched NDJSON events
 *   AUDIT_HTTP_TOKEN  — optional Bearer for the sink
 *   AUDIT_BATCH       — flush when this many events are buffered (default 50)
 *   AUDIT_FLUSH_MS    — periodic flush interval (default 5000)
 */

export type AuditLevel = "off" | "writes" | "all";
export type AuditCategory = "request" | "broker" | "auth" | "admin" | "autonomous";

export interface AuditEvent {
  ts: string;
  category: AuditCategory;
  action: string;
  actor?: { sub?: string | undefined; email?: string | undefined; role?: string | undefined } | null;
  projectId?: string | null;
  status?: number | undefined;
  ms?: number | undefined;
  ip?: string | undefined;
  origin?: string | undefined;
  write?: boolean | undefined;
  /** Outcome of the action — set on brokered n8n actions so logs show success/failure. */
  result?: "success" | "error" | undefined;
  meta?: Record<string, unknown> | undefined;
}

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** The configured audit verbosity (off | writes | all) from AUDIT_LEVEL. */
export function auditLevel(): AuditLevel {
  const raw = process.env["AUDIT_LEVEL"]?.trim().toLowerCase();
  // Default to "writes" for any unset/unrecognised value (audit mutations, not reads).
  return raw === "off" || raw === "all" ? raw : "writes";
}

/** Pure decision: should an event at this level be recorded? */
export function shouldAudit(
  level: AuditLevel,
  ev: { category: AuditCategory; method?: string | undefined; write?: boolean | undefined },
): boolean {
  if (level === "off") return false;
  if (level === "all") return true;
  // level === "writes"
  // auth, admin and autonomous decisions are security-relevant — always recorded.
  if (ev.category === "auth" || ev.category === "admin" || ev.category === "autonomous") return true;
  if (ev.write) return true;
  if (ev.method && WRITE_METHODS.has(ev.method.toUpperCase())) return true;
  return false;
}

// ── External HTTP sink (batched, best-effort, in-memory) ──────────────────────

export interface HttpSink<T = AuditEvent> {
  enqueue(ev: T): void;
  flush(): Promise<number>;
  size(): number;
}

const MAX_BUFFER = 1000;

/** Build a batching HTTP sink (buffers records + flushes them as NDJSON to a SIEM URL). Generic
 *  so it backs both the audit stream and other durable append streams (e.g. the governance log);
 *  defaults to AuditEvent so existing call sites are unchanged. */
export function createHttpSink<T = AuditEvent>(opts: {
  url: string;
  token?: string;
  batch?: number;
  fetchImpl?: typeof fetch;
}): HttpSink<T> {
  const buffer: T[] = [];
  let dropped = 0;
  const doFetch = opts.fetchImpl ?? fetch;
  const batchSize = opts.batch ?? 50;

  async function flush(): Promise<number> {
    if (buffer.length === 0) return 0;
    const events = buffer.splice(0, buffer.length);
    const body = events.map((e) => JSON.stringify(e)).join("\n"); // NDJSON
    try {
      const res = await doFetch(opts.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-ndjson",
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`sink responded ${res.status}`);
      return events.length;
    } catch (err) {
      // Best-effort: re-buffer once (bounded), then drop. Never block requests.
      logger.warn({ err, count: events.length }, "audit sink flush failed");
      for (const e of events) {
        if (buffer.length < MAX_BUFFER) buffer.unshift(e);
        else dropped++;
      }
      if (dropped > 0) logger.warn({ dropped }, "audit events dropped (buffer full)");
      return 0;
    }
  }

  return {
    enqueue(ev) {
      if (buffer.length >= MAX_BUFFER) { dropped++; return; }
      buffer.push(ev);
      if (buffer.length >= batchSize) void flush();
    },
    flush,
    size: () => buffer.length,
  };
}

let sink: HttpSink | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function ensureSink(): HttpSink | null {
  const url = process.env["AUDIT_HTTP_URL"]?.trim();
  if (!url) return null;
  if (!sink) {
    const token = process.env["AUDIT_HTTP_TOKEN"]?.trim();
    sink = createHttpSink({ url, ...(token !== undefined ? { token } : {}), batch: Number(process.env["AUDIT_BATCH"]) || 50 });
    const ms = Number(process.env["AUDIT_FLUSH_MS"]) || 5000;
    timer = setInterval(() => void sink?.flush(), ms);
    timer.unref?.(); // don't keep the process alive for the flush timer
  }
  return sink;
}

/** Record one audit event: stdout (pino) + the external sink, gated by level. */
export function recordAudit(ev: AuditEvent): void {
  // Brokered actions always feed the live admin broker-log ring (independent of
  // the audit level / external sink), so the admin tool sees traffic + failures.
  if (ev.category === "broker") {
    pushBrokerEvent(ev);
    recordBrokerCall(ev.result, ev.ms);
  }
  if (!shouldAudit(auditLevel(), ev)) return;
  // Seal into the tamper-evident hash chain, then emit the SEALED event so the stdout/SIEM
  // copy is self-verifying (each record carries its seq + prevHash + keyed hash).
  if (sharedStateMode() === "redis") {
    // Fleet-shared, fork-free chain head via atomic CAS. The advance needs a Redis round-trip,
    // so it's async + best-effort here — matching this module's stated best-effort delivery
    // ethos (never block a request). The default (no REDIS_URL) path below is byte-identical to
    // before. NOTE: under Redis the seal is therefore emitted asynchronously, so the autonomous
    // fail-closed guarantee (a throwing seal denying the write) applies only to that sync path.
    void sealAuditEventShared(ev)
      .then((sealed) => { logger.info({ audit: true, ...sealed }, "audit"); ensureSink()?.enqueue(sealed); })
      .catch((err) => logger.warn({ err }, "audit chain: shared seal failed"));
    return;
  }
  const sealed = sealAuditEvent(ev);
  logger.info({ audit: true, ...sealed }, "audit");
  ensureSink()?.enqueue(sealed);
}

/** The audit `actor` field for a request — the session's sub + a display role, or `null` when
 *  unauthenticated. Calls `getSession(req)` once; route-local audit helpers used to call it
 *  twice (an existence check, then a `.sub` read) to build this same shape. */
export function actorForAudit(req: Request): { sub: string; role: string } | null {
  const session = getSession(req);
  return session ? { sub: session.sub, role: roleForReq(req) } : null;
}

/** Status for the setup/diagnostics view. */
export function auditStatus(): { level: AuditLevel; sink: boolean } {
  return { level: auditLevel(), sink: !!process.env["AUDIT_HTTP_URL"]?.trim() };
}
