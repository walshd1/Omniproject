import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { getSession } from "./auth";
import { roleForReq, isDeprovisioned } from "../lib/rbac";
import { addClient, clientCount, type NotifyTarget } from "../lib/notify-hub";
import { openSse } from "../lib/sse";
import { getNotifyBus, busMode } from "../lib/notify-bus";
import { emitWebhookEvent } from "../lib/webhooks";
import { routeNotification, getNotificationChannel, notificationSeverity } from "@workspace/backend-catalogue";
import { logger } from "../lib/logger";
import { traceFn } from "../broker/trace";
import type { NotificationIngest, IngestedNotification } from "../broker/contract";

/** The notify-plane dispatch decision, traced/capturable like the broker seam. */
const tracedRouteNotification = traceFn("notify", "route", routeNotification);

/**
 * Two routers:
 *  - streamRouter: GET /notifications/stream (SSE) — requires a user session.
 *  - ingestRouter: POST /notifications/ingest — called by n8n/tools, authed by
 *    NOTIFY_INGEST_SECRET (so external systems can push without a user session).
 */

export const streamRouter: Router = Router();
export const ingestRouter: Router = Router();

// GET /api/notifications/stream — live channel for the in-app bell.
streamRouter.get("/notifications/stream", (req: Request, res: Response) => {
  const session = getSession(req);

  const stream = openSse(res, { ok: true });
  const remove = addClient({
    id: crypto.randomUUID(),
    sub: session?.sub,
    email: session?.email,
    roles: [roleForReq(req)],
    send: stream.send,
    // Graceful shutdown ends the stream; req "close" then runs the cleanup below.
    close: stream.close,
  });

  // SSE keepalive + live revocation: every 25s (under the common 30–60s proxy idle
  // timeout) emit a comment frame so reverse proxies don't drop an otherwise-quiet
  // stream — but first re-check the principal hasn't been deprovisioned mid-stream,
  // and tear the connection down at once if so (a long-lived SSE would otherwise
  // outlive a SCIM `active=false` until the client reconnects).
  const ping = setInterval(() => {
    if (sseKeepaliveTick(req, res)) clearInterval(ping);
  }, 25_000);

  req.on("close", () => {
    clearInterval(ping);
    remove();
  });
});

/**
 * One SSE keepalive tick. If the streaming principal is now deprovisioned, notify the
 * client and end the response (its `close` handler then runs the per-connection
 * cleanup); otherwise write a comment ping. Returns true when the stream was closed.
 */
export function sseKeepaliveTick(req: Request, res: Response): boolean {
  if (isDeprovisioned(req)) {
    try { res.write(`event: revoked\ndata: ${JSON.stringify({ reason: "deprovisioned" })}\n\n`); } catch { /* gone */ }
    try { res.end(); } catch { /* already closed */ }
    return true;
  }
  try { res.write(`: ping\n\n`); } catch { /* gone */ }
  return false;
}

const INGEST_SECRET = process.env["NOTIFY_INGEST_SECRET"]?.trim();

function ingestAuth(req: Request, res: Response, next: NextFunction): void {
  if (!INGEST_SECRET) {
    res.status(503).json({ error: "Notification ingest disabled (set NOTIFY_INGEST_SECRET)" });
    return;
  }
  const header = req.headers["authorization"];
  const token = Array.isArray(header) ? header[0] : header;
  const bearer = token?.startsWith("Bearer ") ? token.slice(7) : token;
  const provided = bearer ?? (req.headers["x-notify-secret"] as string | undefined);
  // Constant-time comparison to avoid leaking the secret via timing.
  const ok = !!provided && provided.length === INGEST_SECRET.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(INGEST_SECRET));
  if (!ok) {
    res.status(401).json({ error: "Invalid ingest secret" });
    return;
  }
  next();
}

// POST /api/notifications/ingest — n8n/tools push an event; the bus fans it out
// across replicas (Redis) or in-process.
ingestRouter.post("/notifications/ingest", ingestAuth, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<NotificationIngest> & { target?: NotifyTarget };
  const n = body.notification as Record<string, unknown> | undefined;
  if (!n || typeof n !== "object" || typeof n["title"] !== "string") {
    res.status(400).json({ error: "notification.title is required" });
    return;
  }
  const notification: IngestedNotification = {
    id: typeof n["id"] === "string" ? n["id"] : crypto.randomUUID(),
    kind: typeof n["kind"] === "string" ? n["kind"] : "info",
    title: n["title"] as string,
    body: (n["body"] as string | null | undefined) ?? null,
    projectId: (n["projectId"] as string | null | undefined) ?? null,
    issueId: (n["issueId"] as string | null | undefined) ?? null,
    read: false,
    timestamp: new Date().toISOString(),
  };
  const localDelivered = await getNotifyBus().publish({ notification, ...(body.target !== undefined ? { target: body.target } : {}) });
  // Generic, above-the-seam DISPATCH: the JSON routing rules decide which external
  // delivery channels this event goes to (gated to channels that actually exist).
  // The DECISION rides along with the outbound event; DELIVERY stays below the seam
  // — the broker workflow reads `dispatch[].channel` and posts to Slack/PagerDuty/…
  const dispatch = tracedRouteNotification({ kind: notification.kind }, (id) => !!getNotificationChannel(id));
  // The kind's canonical severity (info | warning | critical) from the registry —
  // so a downstream channel can prioritise (page on critical, digest on info).
  const severity = notificationSeverity(notification.kind);
  // Also push to any outbound webhook subscribers (premium; no-op if unlicensed
  // or none configured). Fire-and-forget so SSE latency isn't affected.
  emitWebhookEvent("notification", { notification, target: body.target ?? null, dispatch, severity });
  // In-process: exact local count. Redis: delivery is async across replicas, so
  // we report local connections instead of a cross-replica count.
  const delivered = localDelivered ?? clientCount();
  logger.info({ audit: true, action: "notification_ingest", delivered, dispatched: dispatch.length, severity, bus: busMode(), connected: clientCount() }, "notify_ingest");
  res.json({ delivered, connected: clientCount(), bus: busMode(), dispatch, severity });
});
