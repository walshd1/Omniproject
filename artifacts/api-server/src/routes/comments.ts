import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { requireRole, hasRole } from "../lib/rbac";
import { addComment, listComments, getComment, deleteComment, type Comment } from "../lib/comments";
import { getNotifyBus } from "../lib/notify-bus";
import { getBroker, contextFromReq } from "../broker";
import { guardProjectScope } from "../lib/project-scope";
import { recordAudit, actorForAudit } from "../lib/audit";
import { logger } from "../lib/logger";

/**
 * Comment threads (the "comments" feature module) — lightweight collaboration on a work item.
 *
 *   - GET    /api/comments/:roomId              — the thread (any authenticated user).
 *   - POST   /api/comments/:roomId              — add a comment (contributor+). Body: { body }.
 *   - DELETE /api/comments/:roomId/:commentId   — the author, or a pmo/admin.
 *
 * A "room" is the same shared-surface id presence uses (`issue:<projectId>:<issueId>` /
 * `project:<projectId>`). Comments are held in the EPHEMERAL shared-state seam (lib/comments): in
 * memory by default, fleet-wide when Redis is configured. Two things happen above that store:
 *   - @mentions in the body are dispatched over the notify bus (kind "mention"), targeted at the
 *     mentioned token by sub OR email — no user directory needed;
 *   - if `COMMENT_PERSISTENCE=backend`, an issue-scoped comment is ALSO written through to the
 *     backend as a `note` TaskItem via the neutral broker seam (best-effort, additive durability).
 *
 * The module is mounted behind requireAuth + requireFeature by mountFeatureModules, so this router
 * only adds the per-verb RBAC gates.
 */

const router: IRouter = Router();

/** A safe, bounded string (the client controls room/comment ids + body, so clamp length). */
function clean(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

/** The projectId a room belongs to, from the shared surface-id format (`issue:<projectId>:<issueId>` /
 *  `project:<projectId>`), or null when the room isn't project-scoped. */
function projectIdOfRoom(roomId: string): string | null {
  const parts = roomId.split(":");
  return (parts[0] === "issue" || parts[0] === "project") && parts[1] ? parts[1] : null;
}

/** Enforce the caller's project scope on a room whose id encodes a projectId (IDOR guard — the comment
 *  store is keyed only by roomId, so without this any authenticated user could read/post/delete another
 *  tenant's thread by naming its room). A non-project room has no boundary to enforce. */
async function guardRoomScope(req: Request, res: Response, roomId: string): Promise<boolean> {
  const projectId = projectIdOfRoom(roomId);
  return projectId ? guardProjectScope(req, res, projectId) : true;
}

// GET /api/comments/:roomId — read the thread. Any authenticated user may read.
router.get("/comments/:roomId", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  if (!roomId) { res.status(400).json({ error: "roomId is required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;
  res.json({ comments: await listComments(roomId) });
});

// POST /api/comments/:roomId — add a comment. Writers only (a read-only viewer / API token can't post).
router.post("/comments/:roomId", requireRole("contributor"), async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const body = clean((req.body as { body?: unknown } | undefined)?.body, 5000);
  if (!roomId || !body) { res.status(400).json({ error: "roomId and a non-empty body (≤ 5000 chars) are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const session = getSession(req);
  const author = { sub: session?.sub ?? "unknown", label: session?.name || session?.email || session?.sub || "unknown" };
  const comment = await addComment(roomId, author, body, Date.now());

  dispatchMentions(comment);
  await maybePersistToBackend(req, comment).catch((err) => logger.warn({ err }, "comments: backend write-through failed"));

  recordAudit({
    ts: comment.createdAt, category: "request", action: "comment.add",
    actor: actorForAudit(req), write: true, result: "success",
    meta: { roomId, mentions: comment.mentions.length },
  });
  res.status(201).json({ comment });
});

// DELETE /api/comments/:roomId/:commentId — the author, or a pmo/admin (moderation).
router.delete("/comments/:roomId/:commentId", async (req: Request, res: Response) => {
  const roomId = clean(req.params["roomId"], 200);
  const commentId = clean(req.params["commentId"], 80);
  if (!roomId || !commentId) { res.status(400).json({ error: "roomId and commentId are required" }); return; }
  if (!(await guardRoomScope(req, res, roomId))) return;

  const existing = await getComment(roomId, commentId);
  if (!existing) { res.status(404).json({ error: "Unknown comment" }); return; }

  const session = getSession(req);
  const isAuthor = !!session?.sub && session.sub === existing.author.sub;
  if (!isAuthor && !hasRole(req, "pmo") && !hasRole(req, "admin")) {
    res.status(403).json({ error: "Only the comment's author or a PMO/admin can delete it" });
    return;
  }
  await deleteComment(roomId, commentId);
  res.json({ ok: true });
});

/** Fan a comment's @mentions out over the notify bus (kind "mention"). Targeted by sub OR email, so
 *  a mentioned user with a live notification stream gets pinged; no user directory is required. */
function dispatchMentions(comment: Comment): void {
  if (comment.mentions.length === 0) return;
  const bus = getNotifyBus();
  for (const mention of comment.mentions) {
    void bus.publish({
      notification: {
        id: `mention-${comment.id}-${mention}`,
        kind: "mention",
        title: `${comment.author.label} mentioned you`,
        body: comment.body,
        read: false,
        timestamp: comment.createdAt,
      },
      target: { sub: mention, email: mention },
    });
  }
}

/** Optional durable write-through: when COMMENT_PERSISTENCE=backend, persist an issue-scoped comment
 *  as a `note` TaskItem through the neutral broker seam. Project-scoped rooms (no task id) and the
 *  default (off) are a no-op — the ephemeral store is always the source for the thread. */
async function maybePersistToBackend(req: Request, comment: Comment): Promise<void> {
  if (process.env["COMMENT_PERSISTENCE"]?.trim().toLowerCase() !== "backend") return;
  const m = /^issue:([^:]+):([^:]+)$/.exec(comment.roomId);
  if (!m) return; // only issue:<projectId>:<issueId> rooms map to a backend task item
  const [, projectId, issueId] = m;
  await getBroker().createTaskItem(contextFromReq(req), projectId!, issueId!, { kind: "note", content: comment.body });
}

export default router;
