import crypto from "node:crypto";
import type { AuditEvent } from "./audit";

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

const MAX = (() => {
  const n = Number(process.env["BROKER_LOG_SIZE"]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
})();

/** A short, stable label for THIS process, shown on every locally-recorded entry
 *  so a fleet-wide log is attributable. Operator-set `REPLICA_ID` wins; otherwise
 *  a random short id (unique per process). */
const REPLICA = process.env["REPLICA_ID"]?.trim() || crypto.randomUUID().slice(0, 8);
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
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
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

/** Fold an entry that originated on ANOTHER replica into this replica's ring +
 *  live subscribers. Does NOT re-publish — avoids echo storms across the fleet. */
export function foldRemoteEntry(entry: BrokerLogEntry): void {
  ingest(entry, false);
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

export function brokerLogSize(): number {
  return ring.length;
}

/** Test/diagnostic reset. */
export function clearBrokerLog(): void {
  ring.length = 0;
  listeners.clear();
}
