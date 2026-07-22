import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { isDeprovisioned } from "../lib/rbac";
import { joinRoom, setEditing, roomSnapshot, presenceConnectionCount, MAX_PRESENCE_STREAMS_PER_SUB, type PresencePeer } from "../lib/presence-hub";
import { openSse, keepAlive } from "../lib/sse";
import { guardProjectScope } from "../lib/project-scope";

/**
 * Live-collaboration presence routes (the "presence" feature module).
 *
 *   - GET  /api/presence/rooms/:roomId/stream  — SSE: join a room, receive peer snapshots.
 *   - POST /api/presence/rooms/:roomId         — heartbeat / set the field this tab is editing.
 *
 * A "room" is any shared surface id the client picks (e.g. `issue:<projectId>:<issueId>`). Identity
 * comes from the session; the client supplies a per-tab connection id (`cid`) so the POST can find
 * the same connection the stream opened. Presence is ephemeral SSE state — see lib/presence-hub.
 */

const router: IRouter = Router();

/** A safe, bounded room id / cid (the client controls them, so clamp length + charset). */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/** The projectId a room belongs to, from the shared surface-id format (`issue:<projectId>:<issueId>` /
 *  `project:<projectId>`), or null when the room isn't project-scoped. Same format comments.ts uses. */
function projectIdOfRoom(roomId: string): string | null {
  const parts = roomId.split(":");
  return (parts[0] === "issue" || parts[0] === "project") && parts[1] ? parts[1] : null;
}

/** Enforce the caller's project scope on a room whose id encodes a projectId (IDOR guard — the presence
 *  hub is keyed only by roomId, so without this any authenticated principal could join another tenant's
 *  room by naming it: reading the peer roster (sub/label + field being edited) and injecting presence).
 *  Mirrors comments.ts guardRoomScope over the identical shared-surface id. A non-project room has no
 *  boundary to enforce. */
async function guardRoomScope(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = projectIdOfRoom(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}

// GET /api/presence/rooms/:roomId/stream — live peer presence for a shared surface.
router.get("/presence/rooms/:roomId/stream", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const cid = clean(req.query["cid"], 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const session = getSession(req);
  // SSE requires an interactive session: a subless (API-token) principal can't be counted against the
  // per-principal cap, so it must be refused rather than exempted (uncapped held-stream DoS).
  if (!session?.sub) { res.status(403).json({ error: "Presence streaming requires an interactive session." }); return; }
  const sub = session.sub;
  const label = session?.name || session?.email || sub;

  // Cap concurrent presence streams per principal before opening the SSE response.
  if (presenceConnectionCount(sub) >= MAX_PRESENCE_STREAMS_PER_SUB) {
    res.status(429).json({ error: "too many concurrent presence streams for this account" });
    return;
  }

  const stream = openSse(res, { ok: true });
  const leave = joinRoom({ roomId, cid, sub, label, send: stream.send, close: stream.close }, Date.now());
  // Keepalive under the usual proxy idle timeout so a quiet room's stream isn't dropped — and on each
  // tick re-check the principal hasn't been deprovisioned mid-stream (tear it down at once if so, so a
  // deactivated user stops appearing in rooms / receiving peer rosters without waiting to reconnect).
  keepAlive(stream, req, leave, 25_000, () => {
    if (!isDeprovisioned(req)) return false;
    stream.send("revoked", { reason: "deprovisioned" });
    return true;
  });
});

// POST /api/presence/rooms/:roomId — set/refresh the field this tab is editing (advisory lock).
// Body: { cid: string, editing: string | null }. Heartbeating with the same field refreshes the
// soft TTL; sending null releases it. Always advisory — the hard guarantee stays Issue.version.
router.post("/presence/rooms/:roomId", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = (req.body ?? {}) as { cid?: unknown; editing?: unknown };
  const cid = clean(body.cid, 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;
  const editing = body.editing === null ? null : clean(body.editing, 80);
  const ok = setEditing(roomId, cid, editing, Date.now());
  if (!ok) { res.status(409).json({ error: "Unknown connection — (re)open the presence stream first" }); return; }
  const peers: PresencePeer[] = roomSnapshot(roomId, Date.now());
  res.json({ ok: true, peers });
});

export default router;
