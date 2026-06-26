import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { getSession } from "./auth";
import { roleForReq } from "../lib/rbac";
import { addClient, clientCount, type NotifyTarget } from "../lib/notify-hub";
import { getNotifyBus, busMode } from "../lib/notify-bus";
import { emitWebhookEvent } from "../lib/webhooks";
import { logger } from "../lib/logger";
import type { NotificationIngest, IngestedNotification } from "../broker/contract";

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

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const remove = addClient({
    id: crypto.randomUUID(),
    sub: session?.sub,
    email: session?.email,
    roles: [roleForReq(req)],
    send: (event, data) => {
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* connection gone; cleanup runs on close */
      }
    },
    // Graceful shutdown ends the stream; req "close" then runs the cleanup below.
    close: () => { try { res.end(); } catch { /* already closed */ } },
  });

  // SSE keepalive: a comment frame every 25s (under the common 30–60s proxy idle
  // timeout) so reverse proxies don't drop an otherwise-quiet event stream.
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(ping);
    remove();
  });
});

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
  const localDelivered = await getNotifyBus().publish({ notification, target: body.target });
  // Also push to any outbound webhook subscribers (premium; no-op if unlicensed
  // or none configured). Fire-and-forget so SSE latency isn't affected.
  emitWebhookEvent("notification", { notification, target: body.target ?? null });
  // In-process: exact local count. Redis: delivery is async across replicas, so
  // we report local connections instead of a cross-replica count.
  const delivered = localDelivered ?? clientCount();
  logger.info({ audit: true, action: "notification_ingest", delivered, bus: busMode(), connected: clientCount() }, "notify_ingest");
  res.json({ delivered, connected: clientCount(), bus: busMode() });
});
