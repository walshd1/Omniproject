import crypto from "node:crypto";

/**
 * Live collaboration presence hub (Server-Sent Events).
 *
 * Tracks who is *currently looking at* a shared thing (a work item, a project) and, advisorily,
 * which field they are editing. Like the notification hub this is **ephemeral connection state, not
 * persisted application data** — it lives only as long as the SSE streams do, so OmniProject stays
 * stateless and nothing-at-rest. When a tab closes its stream drops and the peer disappears.
 *
 * Two deliberate design choices keep it honest:
 *   - **Advisory, never authoritative.** A field "lock" is a soft, TTL'd hint — "Ada is editing
 *     Status" — to reduce accidental clobbering. It does NOT block anyone. The HARD guarantee stays
 *     the optimistic-concurrency token (`expectedVersion` / Issue.version): two concurrent saves
 *     still resolve by a 409 → refresh, never a silent overwrite. No CRDT, no server merge.
 *   - **Soft TTL.** An editing claim is refreshed by a heartbeat while the field has focus; if the
 *     heartbeats stop (the user walked away, the tab froze) the claim is treated as stale after
 *     {@link LOCK_TTL_MS} and stops showing — without needing the connection itself to drop.
 *
 * Multi-replica note: presence is per-process (connections live on one replica). For fleet-wide
 * presence put a pub/sub in front of `broadcastRoom` (the broker-log / notify buses show the
 * pattern) or use sticky sessions; in-process is correct for a single replica.
 */

/** How long an "editing this field" claim stays live without a refreshing heartbeat. */
export const LOCK_TTL_MS = 15_000;

/** A peer as seen by others in the room (the public, serialisable shape sent over SSE). */
export interface PresencePeer {
  /** Per-tab connection id (the client generates it; stable for that stream). */
  cid: string;
  /** The signed-in user's stable id. */
  sub: string;
  /** Display name (falls back to the sub when no name is known). */
  label: string;
  /** A deterministic colour for this user, so their avatar/cursor is recognisable. */
  color: string;
  /** The field id they are currently editing, or null. Advisory only. */
  editing: string | null;
  /** Epoch-ms of the last editing heartbeat (lets clients expire a stale claim locally too). */
  editingAt: number;
}

interface Connection extends PresencePeer {
  roomId: string;
  send: (event: string, data: unknown) => void;
  close?: () => void;
}

/** roomId → (cid → connection). A room is any shared surface, e.g. `issue:p1:i1` or `project:p1`. */
const rooms = new Map<string, Map<string, Connection>>();

const PALETTE = [
  "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#65a30d", "#ea580c", "#4f46e5",
];

/** A stable colour for a user, derived from their `sub` so it's the same across sessions/devices. */
export function peerColor(sub: string): string {
  const hash = crypto.createHash("sha256").update(sub).digest();
  return PALETTE[hash[0]! % PALETTE.length]!;
}

/** Project a connection to the public peer shape, expiring a stale editing claim against `now`. */
export function toPeer(conn: PresencePeer, now: number, ttl = LOCK_TTL_MS): PresencePeer {
  const fresh = conn.editing !== null && now - conn.editingAt < ttl;
  return {
    cid: conn.cid, sub: conn.sub, label: conn.label, color: conn.color,
    editing: fresh ? conn.editing : null,
    editingAt: conn.editingAt,
  };
}

/** The current peers in a room (editing claims expired against `now`). Empty when the room is idle. */
export function roomSnapshot(roomId: string, now: number, ttl = LOCK_TTL_MS): PresencePeer[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.values()].map((c) => toPeer(c, now, ttl));
}

/** Push the room's current snapshot to every connection in it. */
export function broadcastRoom(roomId: string, now: number): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const peers = roomSnapshot(roomId, now);
  for (const c of room.values()) c.send("presence", { roomId, peers });
}

export interface JoinArgs {
  roomId: string;
  cid: string;
  sub: string;
  label: string;
  send: (event: string, data: unknown) => void;
  close?: () => void;
}

/** Add a connection to a room and announce it. Returns a leave fn that removes + re-announces. */
export function joinRoom(args: JoinArgs, now: number): () => void {
  const { roomId, cid } = args;
  let room = rooms.get(roomId);
  if (!room) { room = new Map(); rooms.set(roomId, room); }
  const conn: Connection = {
    cid, sub: args.sub, label: args.label, color: peerColor(args.sub),
    editing: null, editingAt: 0, roomId, send: args.send, ...(args.close ? { close: args.close } : {}),
  };
  room.set(cid, conn);
  broadcastRoom(roomId, now);
  return () => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.delete(cid);
    if (r.size === 0) rooms.delete(roomId);
    else broadcastRoom(roomId, now);
  };
}

/** Update a connection's editing claim (a field id, or null to release) + heartbeat it. Re-announces. */
export function setEditing(roomId: string, cid: string, field: string | null, now: number): boolean {
  const conn = rooms.get(roomId)?.get(cid);
  if (!conn) return false;
  conn.editing = field;
  conn.editingAt = now;
  broadcastRoom(roomId, now);
  return true;
}

/** Diagnostics for dev mode: how many rooms / connections are live right now. */
export function presenceStats(): { rooms: number; connections: number } {
  let connections = 0;
  for (const r of rooms.values()) connections += r.size;
  return { rooms: rooms.size, connections };
}

/** Close every live presence stream and forget them — used on graceful shutdown. */
export function closeAllPresence(): number {
  let n = 0;
  for (const room of rooms.values()) {
    for (const c of room.values()) {
      n++;
      try { c.close?.(); } catch { /* already gone */ }
    }
  }
  rooms.clear();
  return n;
}

/** Test reset hook — drop all presence state without touching connections. */
export function _resetPresenceForTest(): void {
  rooms.clear();
}
