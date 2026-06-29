import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { joinRoom, setEditing, roomSnapshot, type PresencePeer } from "../lib/presence-hub";
import { openSse, keepAlive } from "../lib/sse";

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

// GET /api/presence/rooms/:roomId/stream — live peer presence for a shared surface.
router.get("/presence/rooms/:roomId/stream", (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const cid = clean(req.query["cid"], 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }

  const session = getSession(req);
  const sub = session?.sub ?? "anonymous";
  const label = session?.name || session?.email || sub;

  const stream = openSse(res, { ok: true });
  const leave = joinRoom({ roomId, cid, sub, label, send: stream.send, close: stream.close }, Date.now());
  // Keepalive under the usual proxy idle timeout so a quiet room's stream isn't dropped.
  keepAlive(stream, req, leave);
});

// POST /api/presence/rooms/:roomId — set/refresh the field this tab is editing (advisory lock).
// Body: { cid: string, editing: string | null }. Heartbeating with the same field refreshes the
// soft TTL; sending null releases it. Always advisory — the hard guarantee stays Issue.version.
router.post("/presence/rooms/:roomId", (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = (req.body ?? {}) as { cid?: unknown; editing?: unknown };
  const cid = clean(body.cid, 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  const editing = body.editing === null ? null : clean(body.editing, 80);
  const ok = setEditing(roomId, cid, editing, Date.now());
  if (!ok) { res.status(409).json({ error: "Unknown connection — (re)open the presence stream first" }); return; }
  const peers: PresencePeer[] = roomSnapshot(roomId, Date.now());
  res.json({ ok: true, peers });
});

export default router;
