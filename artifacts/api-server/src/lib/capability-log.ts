import { recordAudit, createHttpSink, type HttpSink } from "./audit";
import { sharedStateMode, sharedRingPush, sharedRingRead } from "./shared-state";
import { logger } from "./logger";
import { safeParseJson } from "./safe-json";
import type { DeploymentState } from "./settings";
import type { CapabilityKind, Actor } from "./capability-governance";

/**
 * Capability governance's activity/audit LOG — the in-RAM decision ring, its optional external HTTP
 * sink, and the fleet-shared (Redis) mirror. Extracted from capability-governance so the logging
 * infrastructure and its network I/O live apart from capability RESOLUTION; the governance module
 * calls `recordCapabilityEvent` and re-exports the reader functions.
 */

/** The three deployment states a capability — or a shared-log entry's `state` — can hold. */
export const STATES: readonly DeploymentState[] = ["off", "user-defined", "public"];

/** One entry in the live capability activity log (for the admin dashboard). */
export interface CapabilityLogEntry {
  ts: string;
  action: "use" | "blocked" | "configured";
  capability: string;
  kind: CapabilityKind | null;
  surface: string | null;
  state: DeploymentState;
  actor: string | null;
}

/**
 * The governance decision log — every capability use/block/config decision. It is a RAM-only
 * ~200-entry ring by default (fast, per-replica, gone on restart). Two OPT-IN layers extend it
 * without changing that default:
 *
 *  - DURABILITY: set CAPABILITY_LOG_HTTP_URL (+ optional CAPABILITY_LOG_HTTP_TOKEN) to POST each
 *    decision to an external append/SIEM sink (NDJSON, batched, best-effort) — mirrors audit.ts.
 *  - FLEET-SHARING: when REDIS_URL is set, each decision is also mirrored into a shared ring, so
 *    `recentCapabilityLogShared()` reflects the whole fleet's decisions, not just this replica's.
 *
 * The RAM ring stays as the fast local cache in every mode.
 */
const LOG_MAX = 200;
const SHARED_LOG_PREFIX = "cap:log:";
const activityLog: CapabilityLogEntry[] = [];

let logSink: HttpSink<CapabilityLogEntry> | null = null;
function ensureLogSink(): HttpSink<CapabilityLogEntry> | null {
  const url = process.env["CAPABILITY_LOG_HTTP_URL"]?.trim();
  if (!url) return null;
  if (!logSink) {
    const token = process.env["CAPABILITY_LOG_HTTP_TOKEN"]?.trim();
    logSink = createHttpSink<CapabilityLogEntry>({ url, ...(token !== undefined ? { token } : {}), batch: Number(process.env["CAPABILITY_LOG_BATCH"]) || 50 });
  }
  return logSink;
}

function pushLog(entry: CapabilityLogEntry): void {
  activityLog.push(entry); // fast local cache (unchanged default behaviour)
  if (activityLog.length > LOG_MAX) activityLog.shift();
  // Opt-in durability: ship to the external append sink when configured.
  ensureLogSink()?.enqueue(entry);
  // Opt-in fleet-sharing: mirror into the shared ring (best-effort) when Redis-backed.
  if (sharedStateMode() === "redis") {
    void sharedRingPush(SHARED_LOG_PREFIX, JSON.stringify(entry), LOG_MAX).catch((err) =>
      logger.warn({ err }, "capability log: shared mirror failed"));
  }
}

/** Recent capability activity (uses, blocks, config changes), newest first — the fast LOCAL
 *  (per-replica) RAM ring. Unchanged; a sync fast path for callers that don't need the fleet view. */
export function recentCapabilityLog(): CapabilityLogEntry[] {
  return [...activityLog].reverse();
}

const LOG_ACTIONS = new Set<CapabilityLogEntry["action"]>(["use", "blocked", "configured"]);
const CAP_KINDS = new Set<CapabilityKind>(["ai-tool", "mcp", "ai-provider", "vendor", "broker"]);

/** Validate ONE fleet-shared capability-log entry before it's shown on the admin governance dashboard.
 *  A shared-ring entry is written by ANOTHER replica (Redis) ⇒ untrusted input: parse prototype-safe,
 *  bound every string, and coerce each field to its type/enum, dropping a malformed entry rather than
 *  failing the whole read. Mirrors broker-log's sanitizeRemoteEntry — it can't stop a plausible forgery
 *  (inherent to a shared bus) but it stops injection / type-confusion / prototype-pollution. */
function sanitizeSharedLogEntry(rawJson: string): CapabilityLogEntry | null {
  let o: unknown;
  try { o = safeParseJson<unknown>(rawJson); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const str = (v: unknown, n: number): string | null => (typeof v === "string" ? v.slice(0, n) : null);
  const ts = str(r["ts"], 40);
  if (!ts) return null; // a well-formed entry must at least carry a timestamp
  return {
    ts,
    action: LOG_ACTIONS.has(r["action"] as CapabilityLogEntry["action"]) ? (r["action"] as CapabilityLogEntry["action"]) : "use",
    capability: str(r["capability"], 200) ?? "",
    kind: CAP_KINDS.has(r["kind"] as CapabilityKind) ? (r["kind"] as CapabilityKind) : null,
    surface: str(r["surface"], 200),
    state: STATES.includes(r["state"] as DeploymentState) ? (r["state"] as DeploymentState) : "off",
    actor: str(r["actor"], 200),
  };
}

/** Recent capability activity across the FLEET (newest first) when Redis-backed; otherwise the
 *  local ring. Falls back to the local ring if the shared read fails, so it never throws. */
export async function recentCapabilityLogShared(): Promise<CapabilityLogEntry[]> {
  if (sharedStateMode() !== "redis") return recentCapabilityLog();
  try {
    const raw = await sharedRingRead(SHARED_LOG_PREFIX, LOG_MAX);
    // Each entry is sibling-written untrusted input — validate + drop malformed rather than trust the cast.
    return raw.map((v) => sanitizeSharedLogEntry(v)).filter((e): e is CapabilityLogEntry => e !== null).reverse();
  } catch (err) {
    logger.warn({ err }, "capability log: shared read failed — using local ring");
    return recentCapabilityLog();
  }
}

/** Test-only: reset the external log sink (so an env change is re-read). */
export function __resetCapabilityLogSink(): void { logSink = null; }

const actorLabel = (a?: Actor | null): string | null => a?.email ?? a?.sub ?? null;

/** Record one capability event to BOTH the audit log and the live activity ring, sharing the
 *  timestamp between them — the pair every capability event (a use/block decision, an admin
 *  reconfiguring one) writes, differing only in the action name(s), the audit `result`, and
 *  the audit `meta` shape. */
export function recordCapabilityEvent(opts: {
  auditAction: string;
  logAction: CapabilityLogEntry["action"];
  id: string;
  kind: CapabilityKind | null;
  surface: string | null;
  state: DeploymentState;
  actor?: Actor | null | undefined;
  result?: "success" | "error";
  meta: Record<string, unknown>;
}): void {
  const ts = new Date().toISOString();
  recordAudit({
    ts,
    category: "admin",
    action: opts.auditAction,
    actor: opts.actor ?? null,
    write: true,
    ...(opts.result ? { result: opts.result } : {}),
    meta: opts.meta,
  });
  pushLog({ ts, action: opts.logAction, capability: opts.id, kind: opts.kind, surface: opts.surface, state: opts.state, actor: actorLabel(opts.actor) });
}
