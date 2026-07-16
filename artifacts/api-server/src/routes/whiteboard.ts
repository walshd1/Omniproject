import { Router } from "express";
import { withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import {
  brokerHasWhiteboards, listWhiteboards, getWhiteboard, writeWhiteboard,
  sanitizeWhiteboardWrite, WhiteboardError,
} from "../lib/whiteboard";

/**
 * WHITEBOARDS / visual canvas (roadmap 2.3). Freeform canvases whose scenes live in the backend through the
 * broker seam (zero-at-rest); these routes read/write them under the existing RBAC ladder — read = viewer+,
 * create/update = contributor+, delete = manager+. Every write passes the one sanitising choke point
 * (`sanitizeWhiteboardWrite`) before it reaches the broker: the scene is bounded, embedded image blobs are
 * stripped, links are restricted to safe schemes — nothing a user draws is executed or trusted. The routes
 * answer 501 when the active backend has no whiteboard capability.
 */
const router = Router();

/** Guard: 501 when the active backend doesn't model whiteboards. */
function requireWhiteboards(res: import("express").Response): boolean {
  if (!brokerHasWhiteboards()) { res.status(501).json({ error: "this backend does not support whiteboards" }); return false; }
  return true;
}

// GET /api/whiteboards?projectId= — the boards (scene bodies omitted), optionally scoped to a project (viewer+).
router.get("/whiteboards", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_whiteboards failed", async () => {
    if (!requireWhiteboards(res)) return;
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    res.json(await listWhiteboards(req, projectId));
  }),
);

// GET /api/whiteboards/:id — one board with its scene (viewer+).
router.get("/whiteboards/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_whiteboard failed", async () => {
    if (!requireWhiteboards(res)) return;
    const board = await getWhiteboard(req, String(req.params["id"]));
    if (!board) { res.status(404).json({ error: "Whiteboard not found" }); return; }
    res.json(board);
  }),
);

// POST /api/whiteboards — create a board (contributor+).
router.post("/whiteboards", requireRole("contributor"), (req, res) => {
  if (!requireWhiteboards(res)) return;
  let input;
  try { input = sanitizeWhiteboardWrite(req.body); }
  catch (e) { if (e instanceof WhiteboardError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_whiteboard failed", async () => {
    res.status(201).json(await writeWhiteboard(req, "create", input));
  });
});

// PUT /api/whiteboards/:id — update a board (contributor+).
router.put("/whiteboards/:id", requireRole("contributor"), (req, res) => {
  if (!requireWhiteboards(res)) return;
  let input;
  try { input = sanitizeWhiteboardWrite(req.body); }
  catch (e) { if (e instanceof WhiteboardError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "update_whiteboard failed", async () => {
    res.json(await writeWhiteboard(req, "update", { ...input, id: String(req.params["id"]) }));
  });
});

// DELETE /api/whiteboards/:id — remove a board (manager+).
router.delete("/whiteboards/:id", requireRole("manager"), (req, res) =>
  withBrokerErrors(req, res, "delete_whiteboard failed", async () => {
    if (!requireWhiteboards(res)) return;
    await writeWhiteboard(req, "delete", { id: String(req.params["id"]) } as never);
    res.status(204).end();
  }),
);

export default router;
