/**
 * Collaborative-edit relay hub (roadmap 2.1 slice 6 — Yjs co-edit). A DUMB, in-memory fan-out: it keeps a
 * set of open SSE connections per room and rebroadcasts each message a member posts to the OTHER members of
 * the same room. It never parses, stores, or persists the payload — the messages are opaque binary Yjs CRDT
 * updates (base64 in a JSON envelope), and the durable document still lives in the system of record through
 * the broker seam (`writeWikiDoc`). So this hub holds only transient socket registrations, exactly like the
 * presence hub — nothing at rest.
 *
 * Keyed only by roomId, so the ROUTE must enforce room scope (an IDOR guard) before joining — same contract
 * as presence/comments.
 */

export interface CollabConn {
  roomId: string;
  cid: string;
  sub: string;
  /** Push a named SSE event to this connection. */
  send: (event: string, data: unknown) => void;
}

/** Cap concurrent co-edit streams per principal (a runaway tab-opener can't exhaust the server). */
export const MAX_COLLAB_STREAMS_PER_SUB = 20;

/** roomId → (cid → connection). */
const rooms = new Map<string, Map<string, CollabConn>>();

/** How many co-edit streams this principal currently holds (across all rooms). */
export function collabConnectionCount(sub: string): number {
  let n = 0;
  for (const room of rooms.values()) for (const c of room.values()) if (c.sub === sub) n++;
  return n;
}

/** Members currently in a room. */
export function collabRoomSize(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0;
}

/** Join a room; returns a leave function that removes this connection (and drops the room when empty). */
export function joinCollabRoom(conn: CollabConn): () => void {
  let room = rooms.get(conn.roomId);
  if (!room) { room = new Map(); rooms.set(conn.roomId, room); }
  room.set(conn.cid, conn);
  return () => {
    const r = rooms.get(conn.roomId);
    if (!r) return;
    // Only delete if this exact connection is still the one registered (a reconnect may have replaced it).
    if (r.get(conn.cid) === conn) r.delete(conn.cid);
    if (r.size === 0) rooms.delete(conn.roomId);
  };
}

/** Relay `data` (under event `name`) to every member of `roomId` EXCEPT the sender (`fromCid`). Returns how
 *  many peers received it. A best-effort broadcast — a dead socket's guarded `send` is a harmless no-op. */
export function relayToRoom(roomId: string, fromCid: string, name: string, data: unknown): number {
  const room = rooms.get(roomId);
  if (!room) return 0;
  let n = 0;
  for (const [cid, conn] of room) {
    if (cid === fromCid) continue;
    conn.send(name, data);
    n++;
  }
  return n;
}

/** Test hook: drop all rooms/connections. */
export function _resetCollabForTest(): void {
  rooms.clear();
}
