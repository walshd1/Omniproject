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
 * Multi-replica note (now OPT-IN fleet-aware): connections (the live `send` sockets) always live
 * on exactly ONE replica and can never be serialised. So instead of moving sockets, each local
 * presence change (join / leave / editing-change / heartbeat) is PUBLISHED as a small serialisable
 * {@link PresenceEvent} on the presence bus (lib/presence-bus.ts, a RedisBus subclass on its own
 * channel — same optional-Redis pattern as notify-bus / broker-log-bus). Every OTHER replica's
 * subscriber folds that event into a parallel `remoteRooms` mirror ({@link foldRemotePresence}) and
 * re-fans the merged roster to ITS OWN locally-connected sockets — so rosters and editing
 * indicators are consistent fleet-wide. Loop-safe (a replica ignores its own echo) and ghost-safe
 * (remote peers carry a TTL, so a crashed replica's peers expire — see {@link PEER_TTL_MS}).
 *
 * With no `REDIS_URL` the bus is in-process: `remoteRooms` never gains an entry, publishing is a
 * no-op, and every path below behaves EXACTLY as the original local-only hub.
 */

/** How long an "editing this field" claim stays live without a refreshing heartbeat. */
export const LOCK_TTL_MS = 15_000;

/**
 * How long a REMOTE peer (mirrored from another replica) stays in the roster without a refreshing
 * event before it is treated as a ghost and reaped. Only relevant under `REDIS_URL` — in-process
 * there are never any remote peers. It is deliberately longer than the fleet heartbeat cadence (so
 * a live-but-idle peer is never dropped) yet short enough that a crashed replica's peers vanish
 * promptly. A clean disconnect reaps immediately via a "leave" event; this TTL is the backstop for
 * a replica that dies without saying goodbye.
 */
export const PEER_TTL_MS = 30_000;

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

/** A remote peer mirrored from another replica: the public shape plus a `lastSeen` for TTL reaping.
 *  These have NO `send`/`close` — they are display-only entries folded in over the presence bus. */
interface RemotePeer extends PresencePeer {
  /** Epoch-ms of the last event (join / editing-change / heartbeat) that refreshed this peer. */
  lastSeen: number;
}

/** roomId → (cid → remote peer). Parallel to `rooms`; ALWAYS empty without `REDIS_URL`. */
const remoteRooms = new Map<string, Map<string, RemotePeer>>();

/**
 * A serialisable presence change to fan out across the fleet. `upsert` carries the peer's full
 * public state (so a remote replica can expire its editing claim against its own clock); `leave`
 * carries just the cid to remove. This is the ONLY thing that crosses the bus — never a socket.
 */
export interface PresenceEvent {
  kind: "upsert" | "leave";
  roomId: string;
  cid: string;
  /** Present for `upsert`; the peer's public, expirable state at publish time. */
  peer?: PresencePeer;
}

type PresencePublisher = (ev: PresenceEvent) => void;
const publishers = new Set<PresencePublisher>();

/**
 * Register a cross-replica publisher (the presence bus). Returns an unregister. Kept as a hook so
 * presence-hub.ts has NO import of the bus (mirrors registerBrokerLogPublisher — avoids a cycle).
 * Without a registered publisher (single replica, or any test that doesn't boot the bus) every
 * mutation below stays purely local.
 */
export function registerPresencePublisher(p: PresencePublisher): () => void {
  publishers.add(p);
  return () => publishers.delete(p);
}

/** Hand a local change to the cross-replica publishers. A failed publisher must never break the
 *  local hub, and remote-originated changes must NOT come back through here (no re-broadcast). */
function publishPresence(ev: PresenceEvent): void {
  for (const p of publishers) {
    try {
      p(ev);
    } catch {
      /* a dead publisher must never break local presence */
    }
  }
}

/** Project a connection to the raw, publishable peer state (editing NOT yet expired — the receiving
 *  replica expires it against its own clock). */
function rawPeer(conn: Connection): PresencePeer {
  return { cid: conn.cid, sub: conn.sub, label: conn.label, color: conn.color, editing: conn.editing, editingAt: conn.editingAt };
}

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

/**
 * The current peers in a room — LOCAL connections merged with REMOTE peers mirrored from other
 * replicas, both with editing claims expired against `now`. Ghost remote peers (older than
 * {@link PEER_TTL_MS}) are dropped AND pruned here, so a crashed replica's entries reap lazily on
 * the next read. A local connection always wins over a same-cid remote (the socket is the truth).
 * With no remote peers this is byte-for-byte the original local-only snapshot.
 */
export function roomSnapshot(roomId: string, now: number, ttl = LOCK_TTL_MS): PresencePeer[] {
  const out = new Map<string, PresencePeer>();
  const remote = remoteRooms.get(roomId);
  if (remote) {
    for (const [cid, rp] of remote) {
      if (now - rp.lastSeen >= PEER_TTL_MS) { remote.delete(cid); continue; } // ghost reap
      out.set(cid, toPeer(rp, now, ttl));
    }
    if (remote.size === 0) remoteRooms.delete(roomId);
  }
  const room = rooms.get(roomId);
  if (room) for (const c of room.values()) out.set(c.cid, toPeer(c, now, ttl)); // local wins
  return [...out.values()];
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

/** Max concurrent presence streams one principal may hold across all rooms — bounds a held-socket
 *  exhaustion the request rate-limiter (which counts opens, not held connections) can't. */
export const MAX_PRESENCE_STREAMS_PER_SUB = 20;

/** How many live presence connections this principal currently holds across every room. */
export function presenceConnectionCount(sub: string): number {
  let n = 0;
  for (const room of rooms.values()) for (const c of room.values()) if (c.sub === sub) n++;
  return n;
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
  publishPresence({ kind: "upsert", roomId, cid, peer: rawPeer(conn) });
  return () => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.delete(cid);
    if (r.size === 0) rooms.delete(roomId);
    else broadcastRoom(roomId, now);
    // Announce the departure fleet-wide so other replicas drop this peer at once (rather than
    // waiting out its TTL). A crashed replica can't send this — that's what PEER_TTL_MS is for.
    publishPresence({ kind: "leave", roomId, cid });
  };
}

/** Update a connection's editing claim (a field id, or null to release) + heartbeat it. Re-announces. */
export function setEditing(roomId: string, cid: string, field: string | null, now: number): boolean {
  const conn = rooms.get(roomId)?.get(cid);
  if (!conn) return false;
  conn.editing = field;
  conn.editingAt = now;
  broadcastRoom(roomId, now);
  // An editing-change is also the presence heartbeat (it refreshes editingAt); fan it out so remote
  // rosters see the claim AND so this peer's lastSeen is refreshed on every other replica.
  publishPresence({ kind: "upsert", roomId, cid, peer: rawPeer(conn) });
  return true;
}

/**
 * Fold a presence change that originated on ANOTHER replica into this replica's remote mirror, then
 * re-fan the merged roster to our own locally-connected sockets. Does NOT re-publish — that is what
 * prevents an echo loop across the fleet (the bus also suppresses a replica's own echo upstream).
 * `now` is this replica's clock; the remote peer's `lastSeen` is stamped with it for TTL reaping.
 */
export function foldRemotePresence(ev: PresenceEvent, now: number): void {
  if (ev.kind === "leave") {
    const r = remoteRooms.get(ev.roomId);
    if (r) {
      r.delete(ev.cid);
      if (r.size === 0) remoteRooms.delete(ev.roomId);
    }
  } else if (ev.peer) {
    let r = remoteRooms.get(ev.roomId);
    if (!r) { r = new Map(); remoteRooms.set(ev.roomId, r); }
    r.set(ev.cid, { ...ev.peer, lastSeen: now });
  }
  // Re-broadcast to LOCAL sockets only (broadcastRoom is a no-op when no local client is in the
  // room). Crucially this does not call publishPresence, so the event never bounces back onto the bus.
  broadcastRoom(ev.roomId, now);
}

/**
 * Every live LOCAL peer as an `upsert` event — the fleet heartbeat re-publishes these on an interval
 * (Redis mode only) so other replicas keep this node's peers alive past their {@link PEER_TTL_MS}
 * even when nobody is actively editing. Carries each peer's real `editingAt`, so editing expiry
 * stays driven by the last true client heartbeat, not the fleet tick.
 */
export function localPresenceForHeartbeat(): PresenceEvent[] {
  const out: PresenceEvent[] = [];
  for (const [roomId, room] of rooms) {
    for (const conn of room.values()) out.push({ kind: "upsert", roomId, cid: conn.cid, peer: rawPeer(conn) });
  }
  return out;
}

/** Diagnostics for dev mode: how many rooms / connections are live right now (LOCAL sockets only —
 *  the authoritative in-process view; remote mirror entries are not counted). */
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
  remoteRooms.clear();
  return n;
}

/** Test reset hook — drop all presence state (local + remote mirror + publishers) without touching
 *  connections. Clearing publishers keeps bus tests hermetic; single-replica tests register none. */
export function _resetPresenceForTest(): void {
  rooms.clear();
  remoteRooms.clear();
  publishers.clear();
}
