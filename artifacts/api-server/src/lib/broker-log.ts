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
 */

const MAX = (() => {
  const n = Number(process.env["BROKER_LOG_SIZE"]);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 500;
})();

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
}

const ring: BrokerLogEntry[] = [];
type Listener = (e: BrokerLogEntry) => void;
const listeners = new Set<Listener>();

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
  };
}

/** Record a brokered audit event into the ring + notify live subscribers. */
export function pushBrokerEvent(ev: AuditEvent): void {
  const entry = project(ev);
  ring.push(entry);
  if (ring.length > MAX) ring.shift();
  for (const l of listeners) {
    try {
      l(entry);
    } catch {
      /* a dead subscriber must never break recording */
    }
  }
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
