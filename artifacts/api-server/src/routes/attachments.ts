import { Router, type IRouter, type Request, type Response } from "express";
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
 *   - GET    /api/attachments/:roomId                — the room's attachment list (pointers only).
 *   - POST   /api/attachments/:roomId/upload-ticket  — mint a one-shot direct-upload URL (contributor+).
 *   - POST   /api/attachments/:roomId                — record the pointer after a direct upload (contributor+).
 *   - GET    /api/attachments/:roomId/:id/link        — mint a one-shot direct-download URL.
 *   - DELETE /api/attachments/:roomId/:id             — the uploader, or a pmo/admin.
 *
 * The gateway holds ONLY a pointer record (lib/attachments-meta on the ephemeral shared-state seam) and
 * mints short-lived, HMAC-signed tickets; the BYTES travel browser↔sidecar DIRECTLY and never transit the
 * gateway — so a (possibly malicious) upload is only ever inside the hardened attachments-broker container.
 * On upload the browser PUTs to the ticketed portal URL, then POSTs the resulting metadata here; the gateway
 * verifies the blob landed with a server-plane HEAD and records the pointer. When `ATTACHMENTS_SIDECAR_URL`
 * is unset the feature is "not configured" (503); when the byte-path (public URL + ticket secret) is unset
 * the ticket routes report the same while listing/delete keep working.
 *
 * Mounted behind requireAuth + requireFeature by mountFeatureModules, so this router only adds per-verb
 * RBAC gates + the project-scope IDOR guard.
 */

const router: IRouter = Router();

/** Max upload size. Mirrors the sidecar's own cap; advertised to the client and re-checked on record. */
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

/** A storage key we minted (hex, 32 chars from `newStorageKey`). Reject anything else the client sends back. */
function isMintedKey(v: unknown): v is string {
  return typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
}

// GET /api/attachments/:roomId — list the room's attachment pointers. Any authenticated user may read.
router.get("/attachments/:roomId", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  if (!roomId) { res.status(400).json({ error: "roomId is required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;
  res.json({ attachments: await listAttachments(roomId) });
});

// POST /api/attachments/:roomId/upload-ticket — mint a one-shot, direct-to-sidecar upload URL. Writers only.
// No bytes here: the browser PUTs to `uploadUrl` itself, then calls POST /attachments/:roomId to record it.
router.post("/attachments/:roomId/upload-ticket", requireRole("contributor"), async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const filename = safeFilename(body["filename"]);
  const size = typeof body["size"] === "number" && Number.isInteger(body["size"]) ? body["size"] : null;
  if (!roomId || !filename) { res.status(400).json({ error: "roomId and a filename are required" }); return; }
  if (size === null || size <= 0) { res.status(400).json({ error: "a positive integer size is required" }); return; }
  if (size > MAX_BYTES) { res.status(413).json({ error: `file exceeds the ${MAX_BYTES}-byte limit` }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const sidecar = attachmentsSidecar();
  if (!sidecar) { res.status(503).json({ error: "Attachments are not configured (ATTACHMENTS_SIDECAR_URL unset)" }); return; }
  if (!sidecar.canMintTickets()) {
    res.status(503).json({ error: "Attachment uploads are not configured (ATTACHMENTS_SIDECAR_PUBLIC_URL / ATTACHMENTS_TICKET_SECRET unset)" });
    return;
  }

  const storageKey = newStorageKey();
  const { url, expiresAt } = sidecar.mintPortalUrl("put", storageKey, { room: roomId });
  res.status(201).json({ storageKey, uploadUrl: url, expiresAt, maxBytes: MAX_BYTES });
});

// POST /api/attachments/:roomId — record a pointer AFTER the browser uploaded bytes to the ticketed portal.
// The gateway never saw the bytes; it verifies the blob actually landed (server-plane HEAD) and trusts the
// sidecar's size, not the client's claim.
router.post("/attachments/:roomId", requireRole("contributor"), async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const filename = safeFilename(body["filename"]);
  const storageKey = body["storageKey"];
  const contentType = clean(body["contentType"], 200) ?? "application/octet-stream";
  const sha256 = clean(body["sha256"], 64);
  if (!roomId || !filename) { res.status(400).json({ error: "roomId and a filename are required" }); return; }
  if (!isMintedKey(storageKey)) { res.status(400).json({ error: "a valid storageKey is required" }); return; }
  if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) { res.status(400).json({ error: "a valid sha256 is required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const sidecar = attachmentsSidecar();
  if (!sidecar) { res.status(503).json({ error: "Attachments are not configured" }); return; }

  // Verify the upload actually landed in the sidecar and take its size as authoritative (the client's
  // claimed size is never trusted — only what the hardened store reports).
  let head: { size: number } | null;
  try {
    head = await sidecar.headBlob(storageKey);
  } catch (err) {
    logger.warn({ err }, "attachments: sidecar head failed");
    res.status(502).json({ error: "Could not confirm the upload" });
    return;
  }
  if (!head) { res.status(409).json({ error: "No uploaded bytes found for that storageKey" }); return; }
  if (head.size <= 0 || head.size > MAX_BYTES) {
    // Reject and drop the offending blob so nothing over-limit lingers in the sidecar.
    await sidecar.delBlob(storageKey).catch(() => {});
    res.status(413).json({ error: `stored file exceeds the ${MAX_BYTES}-byte limit` });
    return;
  }

  const session = getSession(req);
  const author = { sub: session?.sub ?? "unknown", label: session?.name || session?.email || session?.sub || "unknown" };
  const att = await addAttachment(roomId, { filename, contentType, size: head.size, sha256, storageKey }, author, Date.now());

  recordAudit({
    ts: att.createdAt, category: "request", action: "attachment.add",
    actor: actorForAudit(req), write: true, result: "success",
    meta: { roomId, size: att.size, contentType: att.contentType },
  });
  res.status(201).json({ attachment: att });
});

// GET /api/attachments/:roomId/:id/link — mint a one-shot, direct-from-sidecar download URL (bytes never
// transit the gateway). The ticket carries the original filename so the browser downloads it named.
router.get("/attachments/:roomId/:id/link", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const id = clean(req.params["id"], 80);
  if (!roomId || !id) { res.status(400).json({ error: "roomId and id are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const att = await getAttachment(roomId, id);
  if (!att) { res.status(404).json({ error: "Unknown attachment" }); return; }
  const sidecar = attachmentsSidecar();
  if (!sidecar) { res.status(503).json({ error: "Attachments are not configured" }); return; }
  if (!sidecar.canMintTickets()) {
    res.status(503).json({ error: "Attachment downloads are not configured (ATTACHMENTS_SIDECAR_PUBLIC_URL / ATTACHMENTS_TICKET_SECRET unset)" });
    return;
  }

  const { url, expiresAt } = sidecar.mintPortalUrl("get", att.storageKey, { room: roomId, name: att.filename });
  res.json({ url, expiresAt, filename: att.filename, contentType: att.contentType, size: att.size });
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
