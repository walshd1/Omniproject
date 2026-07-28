import express, { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { getSession } from "./auth";
import { requireRole, hasRole } from "../lib/rbac";
import { guardProjectScope } from "../lib/project-scope";
import { recordAudit, actorForAudit } from "../lib/audit";
import { envInt } from "../lib/env-config";
import { logger } from "../lib/logger";
import { attachmentsSidecar } from "../attachments/sidecar-client";
import {
  addAttachment,
  listAttachments,
  getAttachment,
  deleteAttachment,
  newStorageKey,
} from "../lib/attachments-meta";

/**
 * File attachments (the "attachments" feature module) — attach a file to a work item.
 *
 *   - GET    /api/attachments/:roomId               — the room's attachment list (pointers only).
 *   - POST   /api/attachments/:roomId               — upload a file (contributor+). Raw body = bytes.
 *   - GET    /api/attachments/:roomId/:id/blob       — download the bytes.
 *   - DELETE /api/attachments/:roomId/:id            — the uploader, or a pmo/admin.
 *
 * The gateway holds ONLY a pointer record (lib/attachments-meta on the ephemeral shared-state seam); the
 * bytes live in the attachments-broker sidecar (below the seam), reached through the egress-guarded
 * client. On upload the gateway streams the bytes straight through to the sidecar (never persisting them)
 * and records the pointer. When `ATTACHMENTS_SIDECAR_URL` is unset the feature is "not configured" (503).
 *
 * Mounted behind requireAuth + requireFeature by mountFeatureModules, so this router only adds per-verb
 * RBAC gates + the project-scope IDOR guard.
 */

const router: IRouter = Router();

/** Max upload size. Mirrors the sidecar's own cap; kept a little below to fail fast at the gateway. */
const MAX_BYTES = envInt("ATTACHMENTS_MAX_BYTES", 25 * 1024 * 1024, { min: 1 });

/** A safe, bounded string (client controls room/attachment ids + filename, so clamp + reject controls). */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  // eslint-disable-next-line no-control-regex
  if (!s || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/** The projectId a room belongs to (`issue:<projectId>:<issueId>` / `project:<projectId>`), or null. */
function projectIdOfRoom(roomId: string): string | null {
  const parts = roomId.split(":");
  return (parts[0] === "issue" || parts[0] === "project") && parts[1] ? parts[1] : null;
}

/** Enforce the caller's project scope on a project-scoped room (IDOR guard — the store is keyed only by
 *  roomId, so without this any authed user could reach another tenant's attachments by naming its room). */
async function guardRoomScope(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = projectIdOfRoom(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}

/** A filename reduced to its basename (drop any path the browser included) + bounded. */
function safeFilename(v: unknown): string | null {
  const s = clean(v, 255);
  if (!s) return null;
  const base = s.split(/[\\/]/).pop() ?? s;
  return base && base !== "." && base !== ".." ? base : null;
}

// GET /api/attachments/:roomId — list the room's attachment pointers. Any authenticated user may read.
router.get("/attachments/:roomId", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  if (!roomId) { res.status(400).json({ error: "roomId is required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;
  res.json({ attachments: await listAttachments(roomId) });
});

// POST /api/attachments/:roomId — upload a file. Writers only. Raw body carries the bytes; the filename
// comes from the `x-filename` header (or ?filename=), the content-type from the request's Content-Type.
router.post(
  "/attachments/:roomId",
  requireRole("contributor"),
  express.raw({ type: () => true, limit: MAX_BYTES }),
  async (req: Request, res: Response) => {
    const roomId = clean(req.params["roomId"], 200);
    const filename = safeFilename(req.get("x-filename") ?? (req.query["filename"] as string | undefined));
    if (!roomId || !filename) { res.status(400).json({ error: "roomId and an x-filename header are required" }); return; }
    if (!(await guardRoomScope(req, res, roomId))) return;

    const sidecar = attachmentsSidecar();
    if (!sidecar) { res.status(503).json({ error: "Attachments are not configured (ATTACHMENTS_SIDECAR_URL unset)" }); return; }

    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) { res.status(400).json({ error: "empty upload" }); return; }
    const contentType = clean(req.get("content-type"), 200) ?? "application/octet-stream";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = newStorageKey();

    try {
      await sidecar.putBlob(storageKey, bytes, contentType);
    } catch (err) {
      logger.warn({ err }, "attachments: sidecar upload failed");
      res.status(502).json({ error: "Could not store the file" });
      return;
    }

    const session = getSession(req);
    const author = { sub: session?.sub ?? "unknown", label: session?.name || session?.email || session?.sub || "unknown" };
    const att = await addAttachment(roomId, { filename, contentType, size: bytes.length, sha256, storageKey }, author, Date.now());

    recordAudit({
      ts: att.createdAt, category: "request", action: "attachment.add",
      actor: actorForAudit(req), write: true, result: "success",
      meta: { roomId, size: att.size, contentType: att.contentType },
    });
    res.status(201).json({ attachment: att });
  },
);

// GET /api/attachments/:roomId/:id/blob — download the bytes (streamed from the sidecar).
router.get("/attachments/:roomId/:id/blob", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const id = clean(req.params["id"], 80);
  if (!roomId || !id) { res.status(400).json({ error: "roomId and id are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const att = await getAttachment(roomId, id);
  if (!att) { res.status(404).json({ error: "Unknown attachment" }); return; }
  const sidecar = attachmentsSidecar();
  if (!sidecar) { res.status(503).json({ error: "Attachments are not configured" }); return; }

  let bytes: Buffer | null;
  try {
    bytes = await sidecar.getBlob(att.storageKey);
  } catch (err) {
    logger.warn({ err }, "attachments: sidecar download failed");
    res.status(502).json({ error: "Could not fetch the file" }); return;
  }
  if (!bytes) { res.status(404).json({ error: "File bytes are gone" }); return; }

  res.setHeader("content-type", att.contentType);
  res.setHeader("content-length", String(bytes.length));
  // Force a download with the original name; encode per RFC 5987 so odd characters can't break the header.
  res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
  res.setHeader("x-content-type-options", "nosniff");
  res.end(bytes);
});

// DELETE /api/attachments/:roomId/:id — the uploader, or a pmo/admin (moderation). Drops pointer + bytes.
router.delete("/attachments/:roomId/:id", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const id = clean(req.params["id"], 80);
  if (!roomId || !id) { res.status(400).json({ error: "roomId and id are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const existing = await getAttachment(roomId, id);
  if (!existing) { res.status(404).json({ error: "Unknown attachment" }); return; }

  const session = getSession(req);
  const isUploader = !!session?.sub && session.sub === existing.author.sub;
  if (!isUploader && !hasRole(req, "pmo") && !hasRole(req, "admin")) {
    res.status(403).json({ error: "Only the uploader or a PMO/admin can delete an attachment" });
    return;
  }

  await deleteAttachment(roomId, id);
  // Best-effort byte cleanup — the pointer is already gone, so a sidecar hiccup only leaves an orphan blob.
  const sidecar = attachmentsSidecar();
  if (sidecar) await sidecar.delBlob(existing.storageKey).catch((err) => logger.warn({ err }, "attachments: sidecar delete failed"));

  recordAudit({
    ts: new Date().toISOString(), category: "request", action: "attachment.delete",
    actor: actorForAudit(req), write: true, result: "success", meta: { roomId, id },
  });
  res.json({ ok: true });
});

export default router;
