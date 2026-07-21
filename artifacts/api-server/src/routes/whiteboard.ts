import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import type { Whiteboard, WhiteboardMeta } from "../broker/types";
import { getSession } from "./auth";
import { requireRole, isDeprovisioned } from "../lib/rbac";
import { assertProjectScope, guardProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import { joinCollabRoom, relayToRoom, collabConnectionCount, MAX_COLLAB_STREAMS_PER_SUB } from "../lib/collab-hub";
import { openSse, keepAlive } from "../lib/sse";
import { peerColor } from "../lib/presence-hub";
import { artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact, requireArtifactStore } from "../lib/artifact-store";
import {
  brokerHasWhiteboards, listWhiteboards, getWhiteboard, writeWhiteboard,
  sanitizeWhiteboardWrite, makeWhiteboardId, parseWhiteboardId, whiteboardScope,
  newJsonBoardRow, mergeJsonBoardRow, boardMeta, WhiteboardError, WHITEBOARD_ARTIFACT,
} from "../lib/whiteboard";

/**
 * WHITEBOARDS / visual canvas (roadmap 2.3). A board is saved to a STORAGE TARGET the author chooses — the
 * same pattern OmniProject uses for user-held artifacts across the board:
 *   - `user`     the caller's PRIVATE encrypted-JSON area (only they ever see it — the scope always uses
 *                the caller's OWN sub, so one user's id can never address another's area).
 *   - `project`  a project's shared encrypted-JSON area (gated by the caller's project scope).
 *   - `org`      the org-wide shared encrypted-JSON area (writing needs manager+).
 *   - `sidecar`  the built-in system-of-record (the OmniStore), when it's loaded.
 * Every JSON collection is AES-256-GCM sealed at rest (see lib/artifact-store), so zero-at-rest holds; where
 * no config dir is set the JSON store is simply disabled and only the sidecar (or 501) remains. The broker
 * is NOT the primary home — it's just one optional target.
 *
 * A board's id is SELF-DESCRIBING (`<target>~…~<localId>`), so a later read/write routes to the right store
 * without a lookup. Every write passes the one sanitising choke point (`sanitizeWhiteboardWrite`): the scene
 * is bounded, embedded blobs are stripped, links are restricted to safe schemes — nothing a user draws is
 * executed or trusted. RBAC floors: read = viewer+, author = contributor+, delete = contributor+ (with the
 * org target additionally requiring manager+ to write or delete).
 */
const router = Router();

/** Per-target authorization for one board operation (the shared storage-target gate). */
const authorizeTarget = (
  req: Parameters<typeof authorizeStorageTarget>[0], res: Parameters<typeof authorizeStorageTarget>[1],
  storage: Parameters<typeof authorizeStorageTarget>[2], projectId: string | undefined, op: "read" | "write",
): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, {
    capability: brokerHasWhiteboards(), capabilityError: "this backend does not support whiteboards",
  });

// GET /api/whiteboards?projectId= — the boards (scene bodies omitted) the caller can reach, aggregated across
// every accessible store: their private area, the org area, the requested project's area (when in scope) and
// the sidecar. viewer+.
router.get("/whiteboards", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_whiteboards failed", async () => {
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const metas: WhiteboardMeta[] = [];
    if (artifactStoreEnabled()) {
      if (ctx.sub) for (const b of listArtifacts<Whiteboard>(WHITEBOARD_ARTIFACT, { kind: "user", sub: ctx.sub })) metas.push(boardMeta(b));
      for (const b of listArtifacts<Whiteboard>(WHITEBOARD_ARTIFACT, { kind: "org" })) metas.push(boardMeta(b));
      if (projectId && (await assertProjectScope(req, projectId)).ok) {
        for (const b of listArtifacts<Whiteboard>(WHITEBOARD_ARTIFACT, { kind: "project", projectId })) metas.push(boardMeta(b));
      }
    }
    if (brokerHasWhiteboards()) {
      for (const b of await listWhiteboards(req, projectId)) metas.push({ ...boardMeta(b), id: makeWhiteboardId("sidecar", b.id), storage: "sidecar" });
    }
    res.json(metas);
  }),
);

// GET /api/whiteboards/:id — one board with its scene (viewer+); the id encodes which store to read.
router.get("/whiteboards/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_whiteboard failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseWhiteboardId(id);
    if (!parsed) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    if (parsed.storage === "sidecar") {
      if (!brokerHasWhiteboards()) { res.status(501).json({ error: "this backend does not support whiteboards" }); return; }
      const board = await getWhiteboard(req, parsed.localId);
      if (!board) { res.status(404).json({ error: "Whiteboard not found" }); return; }
      res.json({ ...board, id, storage: "sidecar" });
      return;
    }
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const ctx = contextFromReq(req);
    const scope = whiteboardScope(parsed, ctx.sub);
    if (!scope) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    const board = getArtifact<Whiteboard>(WHITEBOARD_ARTIFACT, scope, id);
    if (!board) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    res.json(board);
  }),
);

// POST /api/whiteboards — create a board in the chosen storage target (contributor+).
router.post("/whiteboards", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeWhiteboardWrite(req.body); }
  catch (e) { if (e instanceof WhiteboardError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_whiteboard failed", async () => {
    if (!(await authorizeTarget(req, res, input.storage, input.projectId, "write"))) return;
    if (input.storage === "sidecar") {
      const board = await writeWhiteboard(req, "create", input);
      res.status(201).json(board ? { ...board, id: makeWhiteboardId("sidecar", board.id), storage: "sidecar" } : board);
      return;
    }
    if (!requireArtifactStore(res)) return;
    const ctx = contextFromReq(req);
    const scope = whiteboardScope(input, ctx.sub);
    if (!scope) { res.status(400).json({ error: "invalid storage target" }); return; }
    const id = makeWhiteboardId(input.storage, crypto.randomUUID(), input.projectId);
    const row = newJsonBoardRow(id, input, ctx, new Date().toISOString());
    putArtifact(WHITEBOARD_ARTIFACT, scope, row);
    res.status(201).json(row);
  });
});

// PUT /api/whiteboards/:id — update a board in place (contributor+); the id governs which store is written.
router.put("/whiteboards/:id", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeWhiteboardWrite(req.body); }
  catch (e) { if (e instanceof WhiteboardError) { res.status(400).json({ error: e.message }); return; } throw e; }
  const id = String(req.params["id"]);
  const parsed = parseWhiteboardId(id);
  if (!parsed) { res.status(404).json({ error: "Whiteboard not found" }); return; }
  return withBrokerErrors(req, res, "update_whiteboard failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (parsed.storage === "sidecar") {
      const board = await writeWhiteboard(req, "update", { ...input, id: parsed.localId });
      if (!board) { res.status(404).json({ error: "Whiteboard not found" }); return; }
      res.json({ ...board, id, storage: "sidecar" });
      return;
    }
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = whiteboardScope(parsed, ctx.sub);
    if (!scope) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    const existing = getArtifact<Whiteboard>(WHITEBOARD_ARTIFACT, scope, id);
    if (!existing) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    const row = mergeJsonBoardRow(existing, input, ctx, new Date().toISOString());
    putArtifact(WHITEBOARD_ARTIFACT, scope, row);
    res.json(row);
  });
});

// DELETE /api/whiteboards/:id — remove a board (contributor+; the org target additionally needs manager+).
router.delete("/whiteboards/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "delete_whiteboard failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseWhiteboardId(id);
    if (!parsed) { res.status(204).end(); return; } // malformed id → nothing to delete (idempotent)
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (parsed.storage === "sidecar") {
      await writeWhiteboard(req, "delete", { id: parsed.localId } as never);
      res.status(204).end();
      return;
    }
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const ctx = contextFromReq(req);
    const scope = whiteboardScope(parsed, ctx.sub);
    if (!scope) { res.status(204).end(); return; }
    deleteArtifact(WHITEBOARD_ARTIFACT, scope, id);
    res.status(204).end();
  }),
);

// ── Live cursors (roadmap 2.3) ──────────────────────────────────────────────────────────────────────────
// Multi-user cursor presence on a board, over the SAME generic in-memory relay the wiki co-edit uses
// (lib/collab-hub) but on a distinct `board:<id>` room space. Purely transient — like presence, nothing is
// stored (the durable scene still saves through the storage target). Position comes from the client; the
// sender's LABEL + COLOUR are stamped server-side from the session, so a client can't spoof another person.

/** A safe, bounded room id / cid (client-controlled → clamp length). */
function cleanRoom(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return !s || s.length > max ? null : s;
}

/** The projectId a cursor room's board id encodes (`board:project~<projectId>~<localId>`), or null — so a
 *  project board's cursor room is scope-guarded (IDOR); user/org/sidecar boards have no project boundary. */
function roomBoardProjectId(roomId: string): string | null {
  if (!roomId.startsWith("board:")) return null;
  const parsed = parseWhiteboardId(roomId.slice("board:".length));
  return parsed?.storage === "project" ? (parsed.projectId ?? null) : null;
}

async function guardCursorRoom(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = roomBoardProjectId(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}

// GET /api/whiteboards/rooms/:roomId/stream — join a board's live-cursor room, receive peers' cursors (viewer+).
router.get("/whiteboards/rooms/:roomId/stream", requireRole("viewer"), async (req: Request, res: Response) => {
  const roomId = cleanRoom(req.params["roomId"], 200);
  const cid = cleanRoom(req.query["cid"], 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardCursorRoom(req, res, roomId))) return;
  const sub = getSession(req)?.sub ?? "anonymous";
  if (sub !== "anonymous" && collabConnectionCount(sub) >= MAX_COLLAB_STREAMS_PER_SUB) {
    res.status(429).json({ error: "too many concurrent cursor streams for this account" });
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

// POST /api/whiteboards/rooms/:roomId — broadcast this tab's cursor position to the room (viewer+).
// Body: { cid, msg: { x, y } }. The position is opaque + bounded; identity is stamped server-side.
router.post("/whiteboards/rooms/:roomId", requireRole("viewer"), async (req: Request, res: Response) => {
  const roomId = cleanRoom(req.params["roomId"], 200);
  const body = (req.body ?? {}) as { cid?: unknown; msg?: unknown };
  const cid = cleanRoom(body.cid, 80);
  if (!roomId || !cid) { res.status(400).json({ error: "roomId and cid are required" }); return; }
  if (!(await guardCursorRoom(req, res, roomId))) return;
  if (JSON.stringify(body.msg ?? null).length > 2_000) { res.status(413).json({ error: "message too large" }); return; }
  const session = getSession(req);
  const sub = session?.sub ?? "anonymous";
  const label = session?.name || session?.email || "Someone";
  const delivered = relayToRoom(roomId, cid, "cursor", { from: cid, label, color: peerColor(sub), msg: body.msg });
  res.json({ ok: true, delivered });
});

export default router;
