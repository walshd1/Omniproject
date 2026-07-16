import crypto from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import type { Whiteboard, WhiteboardMeta } from "../broker/types";
import { hasRole, requireRole } from "../lib/rbac";
import { guardProjectScope, assertProjectScope } from "../lib/project-scope";
import {
  artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact,
} from "../lib/artifact-store";
import {
  brokerHasWhiteboards, listWhiteboards, getWhiteboard, writeWhiteboard,
  sanitizeWhiteboardWrite, makeWhiteboardId, parseWhiteboardId, whiteboardScope,
  newJsonBoardRow, mergeJsonBoardRow, boardMeta, WhiteboardError, WHITEBOARD_ARTIFACT,
} from "../lib/whiteboard";
import type { WhiteboardStorage } from "../lib/whiteboard";

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

/**
 * Per-target authorization for one board operation. Returns true when allowed; otherwise it has already
 * sent the response (403/400/501) and the caller must return. The RBAC floor (viewer read / contributor
 * write) is applied by the route middleware; this adds the target-specific rule on top.
 */
async function authorizeTarget(
  req: Request, res: Response, storage: WhiteboardStorage, projectId: string | undefined, op: "read" | "write",
): Promise<boolean> {
  switch (storage) {
    case "user":
      return true; // the caller's own private area — structurally isolated (scope uses the caller's sub)
    case "project":
      if (!projectId) { res.status(400).json({ error: "a project whiteboard needs a projectId" }); return false; }
      return guardProjectScope(req, res, projectId); // 403 + audit on a cross-scope id
    case "org":
      // Org-wide: reads are open to any viewer+ (already floored); writes/deletes need manager+.
      if (op === "write" && !hasRole(req, "manager")) {
        res.status(403).json({ error: "org-wide whiteboards require at least the manager role" });
        return false;
      }
      return true;
    case "sidecar":
      if (!brokerHasWhiteboards()) { res.status(501).json({ error: "this backend does not support whiteboards" }); return false; }
      return true;
  }
}

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
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
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

export default router;
