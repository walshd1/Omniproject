import { Router, type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { getSession } from "./auth";
import { roleForReq, isDeprovisioned, ROLES } from "../lib/rbac";
import { addClient, clientCount, canAddClient } from "../lib/notify-hub";
import { constantTimeEqual } from "../lib/crypto-keys";
import { openSse, keepAlive, type SseStream } from "../lib/sse";
import { getNotifyBus, busMode } from "../lib/notify-bus";
import { emitWebhookEvent } from "../lib/webhooks";
import { routeNotification, getNotificationChannel, notificationSeverity } from "@workspace/backend-catalogue";
import { logger } from "../lib/logger";
import { traceFn } from "../broker/trace";
import { v, parseOr400 } from "../lib/validate";
import type { IngestedNotification } from "../broker/contract";

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

  // SSE requires an INTERACTIVE session. A read-only API/BI token has no `sub`, so it can't be counted
  // against the per-principal stream cap — an uncapped held stream is a socket/timer-exhaustion DoS.
  // Refuse it up front (the in-app bell is a session feature; tokens are for data feeds, not streams).
  if (!session?.sub) {
    res.status(403).json({ error: "Notification streaming requires an interactive session." });
    return;
  }

  // Cap concurrent streams per principal BEFORE opening the SSE response (a held connection isn't
  // counted by the request rate-limiter). Reject with 429 rather than opening an uncapped stream.
  if (!canAddClient(session?.sub)) {
    res.status(429).json({ error: "too many concurrent notification streams for this account" });
    return;
  }

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

  // SSE keepalive + live revocation via the shared helper: every 25s (under the common 30–60s proxy
  // idle timeout) it emits a comment ping so reverse proxies don't drop an otherwise-quiet stream, and
  // the onTick re-checks the principal hasn't been deprovisioned mid-stream — tearing the connection
  // down at once if so (a long-lived SSE would otherwise outlive a SCIM `active=false`). keepAlive runs
  // `remove` (the notify-hub unsubscribe) EXACTLY ONCE whichever path fires — client disconnect OR the
  // onTick self-close — so the deprovision path can't leak a zombie client into the per-sub cap.
  keepAlive(stream, req, remove, 25_000, () => revokedIfDeprovisioned(req, stream));
});

/**
 * keepAlive onTick for the notify stream: if the streaming principal was deprovisioned mid-connection,
 * emit a `revoked` frame and return true so the helper tears the stream down (and runs the addClient
 * unsubscribe once); otherwise return false and the helper writes its keepalive ping. Pure w.r.t. the
 * socket — closing + cleanup are the helper's job, which is what makes the unsubscribe leak-free.
 */
export function revokedIfDeprovisioned(req: Request, stream: SseStream): boolean {
  if (!isDeprovisioned(req)) return false;
  stream.send("revoked", { reason: "deprovisioned" });
  return true;
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
  // Constant-time comparison (shared helper) to avoid leaking the secret via timing.
  const ok = !!provided && constantTimeEqual(provided, INGEST_SECRET);
  if (!ok) {
    res.status(401).json({ error: "Invalid ingest secret" });
    return;
  }
  next();
}

// Border validation for this externally-driven route: n8n/tools push arbitrary JSON
// in with only a shared secret standing between it and the notify bus, so every
// field is bounded/typed here rather than trusted as-is (the previous version cast
// `req.body` with loose fallbacks and no length caps — a bad or malicious sender
// could push unbounded strings straight into the bus/webhook fan-out).
const NOTIFY_TARGET_BODY = v.object({
  sub: v.optional(v.string({ trim: true, min: 1, max: 200 })),
  email: v.optional(v.string({ trim: true, min: 1, max: 320 })),
  // A fixed RBAC role, not a free-form string — an unrecognised value (wrong case, a
  // typo, a role that doesn't exist) would otherwise silently match no client at all.
  role: v.optional(v.enum(ROLES)),
});
const NOTIFICATION_INGEST_BODY = v.object({
  notification: v.object({
    id: v.nullable(v.string({ trim: true, min: 1, max: 200 })),
    kind: v.nullable(v.string({ trim: true, min: 1, max: 100 })),
    title: v.string({ trim: true, min: 1, max: 500 }),
    body: v.nullable(v.string({ max: 10_000 })),
    projectId: v.nullable(v.string({ trim: true, min: 1, max: 200 })),
    issueId: v.nullable(v.string({ trim: true, min: 1, max: 200 })),
  }),
  target: v.optional(NOTIFY_TARGET_BODY),
});

// POST /api/notifications/ingest — n8n/tools push an event; the bus fans it out
// across replicas (Redis) or in-process.
ingestRouter.post("/notifications/ingest", ingestAuth, async (req: Request, res: Response) => {
  const parsed = parseOr400(req, res, NOTIFICATION_INGEST_BODY);
  if (!parsed) return;
  const n = parsed.notification;
  const notification: IngestedNotification = {
    id: n.id ?? crypto.randomUUID(),
    kind: n.kind ?? "info",
    title: n.title,
    body: n.body ?? null,
    projectId: n.projectId ?? null,
    issueId: n.issueId ?? null,
    read: false,
    timestamp: new Date().toISOString(),
  };
  const target = parsed.target;
  const localDelivered = await getNotifyBus().publish({ notification, ...(target !== undefined ? { target } : {}) });
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
  emitWebhookEvent("notification", { notification, target: target ?? null, dispatch, severity });
  // In-process: exact local count. Redis: delivery is async across replicas, so
  // we report local connections instead of a cross-replica count.
  const delivered = localDelivered ?? clientCount();
  logger.info({ audit: true, action: "notification_ingest", delivered, dispatched: dispatch.length, severity, bus: busMode(), connected: clientCount() }, "notify_ingest");
  res.json({ delivered, connected: clientCount(), bus: busMode(), dispatch, severity });
});
