import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { isDeprovisioned, requireRole } from "../lib/rbac";
import { joinCollabRoom, relayToRoom, collabConnectionCount, MAX_COLLAB_STREAMS_PER_SUB } from "../lib/collab-hub";
import { openSse, keepAlive } from "../lib/sse";
import { guardProjectScope } from "../lib/project-scope";

/**
 * Real-time collaborative-edit relay (the "wikiCoEdit" feature module, roadmap 2.1 slice 6).
 *
 *   - GET  /api/collab/rooms/:roomId/stream  — SSE: join a co-edit room, receive peers' CRDT messages.
 *   - POST /api/collab/rooms/:roomId         — post a CRDT message; the server fans it out to the room.
 *
 * The server is a DUMB relay: it never parses or stores the payload (opaque base64 Yjs updates), it only
 * rebroadcasts to the other members. The durable document stays in the system of record via the broker seam
 * (`writeWikiDoc`) — the CRDT stream is transient editing state, like presence. Co-editing is an authoring
 * act, so both routes require contributor+ (a viewer reads the saved doc, not the live edit stream). Rooms
 * that encode a projectId are scope-guarded (IDOR); a `doc:<id>` wiki room is org-content (no boundary),
 * matching how presence/comments treat non-project rooms.
 */

const router: IRouter = Router();

/** A safe, bounded room id / cid (client-controlled → clamp length). */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/** The projectId a room encodes (`issue:<pid>:…` / `project:<pid>`), or null. Same format as presence/comments. */
function projectIdOfRoom(roomId: string): string | null {
  const parts = roomId.split(":");
  return (parts[0] === "issue" || parts[0] === "project") && parts[1] ? parts[1] : null;
}

/** Enforce project scope on a room whose id encodes a projectId (IDOR guard); non-project rooms have no boundary. */
async function guardRoomScope(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = projectIdOfRoom(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}

// GET /api/collab/rooms/:roomId/stream — join a co-edit room and receive peers' messages (contributor+).
router.get("/collab/rooms/:roomId/stream", requireRole("contributor"), async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const cid = clean(req.query["cid"], 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const session = getSession(req);
  // SSE requires an interactive session: a subless (API-token) principal can't be capped, so refuse it
  // rather than exempt it from the per-principal held-stream cap (uncapped-socket DoS).
  if (!session?.sub) { res.status(403).json({ error: "Co-edit streaming requires an interactive session." }); return; }
  const sub = session.sub;
  if (collabConnectionCount(sub) >= MAX_COLLAB_STREAMS_PER_SUB) {
    res.status(429).json({ error: "too many concurrent co-edit streams for this account" });
    return;
  }

  const stream = openSse(res, { ok: true });
  const leave = joinCollabRoom({ roomId, cid, sub, send: stream.send });
  keepAlive(stream, req, leave, 25_000, () => {
    if (!isDeprovisioned(req)) return false;
    stream.send("revoked", { reason: "deprovisioned" });
    return true;
  });
});

// POST /api/collab/rooms/:roomId — relay a CRDT message to the room (contributor+).
// Body: { cid: string, msg: unknown }. `msg` is opaque to the server (a client-defined { t, u|sv } envelope);
// it is fanned out verbatim to the OTHER members under the `collab` event.
router.post("/collab/rooms/:roomId", requireRole("contributor"), async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = (req.body ?? {}) as { cid?: unknown; msg?: unknown };
  const cid = clean(body.cid, 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;
  // Bound the relayed payload so a client can't push an unbounded blob through the fan-out.
  if (typeof body.msg === "string" ? body.msg.length > 200_000 : JSON.stringify(body.msg ?? null).length > 200_000) {
    res.status(413).json({ error: "message too large" });
    return;
  }
  const delivered = relayToRoom(roomId, cid, "collab", { from: cid, msg: body.msg });
  res.json({ ok: true, delivered });
});

export default router;
