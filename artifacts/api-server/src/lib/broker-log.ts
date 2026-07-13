import crypto from "node:crypto";
import type { AuditEvent } from "./audit";
import { envInt } from "./env-config";
import { pushBounded } from "./ring-buffer";

/**
 * In-session broker activity log — a BOUNDED, in-memory ring of the most recent
 * brokered actions, so an admin can watch the gateway → broker → backend traffic
 * live (and see failures the moment they happen).
 *
 * Memory-safe by construction: a fixed-size ring (oldest evicted), nothing
 * persisted, gone on restart — consistent with the stateless posture. It holds a
 * REDACTED projection of the audit event (action/result/status/ms/actor), never
 * tokens or raw upstream bodies.
 *
 * Multi-replica: each replica keeps its OWN ring (a deliberately bounded local
 * view). When `REDIS_URL` is set, the broker-log bus (broker-log-bus.ts) fans
 * local entries out to the other replicas via Pub/Sub and folds theirs in via
 * `foldRemoteEntry`, so an admin sees the **whole fleet's** traffic live. Each
 * entry carries a short `replica` label so you can tell which node served it. The
 * bus is wired through `registerBrokerLogPublisher` to avoid a circular import.
 */

const MAX = Math.min(envInt("BROKER_LOG_SIZE", 500, { min: 1 }), 5000);

/** A short, stable label for THIS process, shown on every locally-recorded entry
 *  so a fleet-wide log is attributable. Operator-set `REPLICA_ID` wins; otherwise
 *  a random short id (unique per process). */
const REPLICA = process.env["REPLICA_ID"]?.trim() || crypto.randomUUID().slice(0, 8);
/** This process's short, stable replica label (operator `REPLICA_ID` or a random id). */
export function brokerLogReplicaId(): string {
  return REPLICA;
}

export interface BrokerLogEntry {
  ts: string;
  action: string;
  result: "success" | "error";
  status: number;
  ms: number;
  projectId: string | null;
  actor: string | null;
  /** A short, redacted note (error name/message) — never an upstream body. */
  note: string | null;
  /** Which replica recorded this entry (for a fleet-wide view). */
  replica: string;
}

const ring: BrokerLogEntry[] = [];
type Listener = (e: BrokerLogEntry) => void;
const listeners = new Set<Listener>();
type Publisher = (e: BrokerLogEntry) => void;
const publishers = new Set<Publisher>();

function project(ev: AuditEvent): BrokerLogEntry {
  const result: "success" | "error" = ev.result ?? ((ev.status ?? 0) >= 400 ? "error" : "success");
  const meta = ev.meta ?? {};
  const note =
    typeof meta["error"] === "string" ? meta["error"] :
    typeof meta["message"] === "string" ? (meta["message"] as string) : null;
  return {
    ts: ev.ts,
    action: ev.action,
    result,
    status: ev.status ?? 0,
    ms: ev.ms ?? 0,
    projectId: ev.projectId ?? null,
    actor: ev.actor?.sub ?? null,
    note: note ? note.slice(0, 200) : null,
    replica: REPLICA,
  };
}

/** Add an entry to the ring + notify live SSE subscribers. When `publish` is true
 *  (a locally-recorded entry) it is also handed to the cross-replica publishers;
 *  remote entries fold in with `publish: false` so they are never re-broadcast. */
function ingest(entry: BrokerLogEntry, publish: boolean): void {
  pushBounded(ring, entry, MAX);
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      /* a dead subscriber must never break recording */
    }
  }
  if (publish) {
    for (const p of publishers) {
      try {
        p(entry);
      } catch {
        /* a failed publisher must never break local recording */
      }
    }
  }
}

/** Record a brokered audit event into the ring, notify live subscribers, and fan
 *  it out to the other replicas (if the bus is enabled). */
export function pushBrokerEvent(ev: AuditEvent): void {
  ingest(project(ev), true);
}

/** Validate + clamp an entry received from ANOTHER replica before it lands in the admin log/SSE. The
 *  local path goes through project() (which clamps note to 200 chars and normalises every field); the
 *  remote fold must apply the same discipline, else a hostile/buggy replica could inject a fully-forged
 *  row with oversized or wrong-typed fields. (It can't stop a plausible-looking forgery — that trust is
 *  inherent to a shared bus — but it stops injection/type-confusion and bounds every string.) */
function sanitizeRemoteEntry(e: unknown): BrokerLogEntry | null {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  const str = (v: unknown, n: number): string | null => (typeof v === "string" ? v.slice(0, n) : null);
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const ts = str(r["ts"], 40);
  if (!ts) return null; // a well-formed entry must at least carry a timestamp
  return {
    ts,
    action: str(r["action"], 400) ?? "",
    result: r["result"] === "error" ? "error" : "success",
    status: num(r["status"]),
    ms: num(r["ms"]),
    projectId: str(r["projectId"], 400),
    actor: str(r["actor"], 400),
    note: str(r["note"], 200),
    replica: str(r["replica"], 64) ?? "remote",
  };
}

/** Fold an entry that originated on ANOTHER replica into this replica's ring +
 *  live subscribers. Does NOT re-publish — avoids echo storms across the fleet. */
export function foldRemoteEntry(entry: BrokerLogEntry): void {
  const clean = sanitizeRemoteEntry(entry);
  if (clean) ingest(clean, false);
}

/** Register a cross-replica publisher (the broker-log bus). Returns an
 *  unregister. Kept as a hook so broker-log.ts has no import of the bus. */
export function registerBrokerLogPublisher(p: Publisher): () => void {
  publishers.add(p);
  return () => publishers.delete(p);
}

/** Snapshot of the current ring (oldest first). */
export function getBrokerLog(): BrokerLogEntry[] {
  return [...ring];
}

/** Subscribe to live entries; returns an unsubscribe. */
export function subscribeBrokerLog(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Current number of buffered broker-log entries (bounded ring). */
export function brokerLogSize(): number {
  return ring.length;
}

/** Test/diagnostic reset. */
export function clearBrokerLog(): void {
  ring.length = 0;
  listeners.clear();
}
