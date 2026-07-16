import { Router, type Request, type Response } from "express";
import { getSession } from "./auth";
import { requireRole } from "../lib/rbac";
import { vapidPublicKey, pushConfigured } from "../lib/web-push";
import { sanitizeSubscription, savePushSubscription, removePushSubscription } from "../lib/push-subscriptions";

/**
 * Browser Web Push subscription routes (roadmap 2.5 slice 3), behind the default-off `pushNotifications`
 * feature module. A signed-in user registers their device's push subscription so personal notifications can
 * reach it when the PWA is closed. Subscriptions are stored per-user, AES-256-GCM sealed (see
 * lib/push-subscriptions); delivery rides the existing notify bus (see lib/push-delivery). All routes are
 * viewer+ — registering YOUR OWN device is not an authoring act — and 501 when VAPID keys aren't configured.
 */
const router = Router();

/** The signed-in caller's sub, or null. */
const callerSub = (req: Request): string | null => getSession(req)?.sub ?? null;

// GET /api/push/vapid-key — the public VAPID key the client needs for pushManager.subscribe (viewer+).
router.get("/push/vapid-key", requireRole("viewer"), (_req: Request, res: Response) => {
  const key = vapidPublicKey();
  if (!key) { res.status(501).json({ error: "push notifications are not configured on this deployment" }); return; }
  res.json({ publicKey: key });
});

// POST /api/push/subscribe — register this device's push subscription for the caller (viewer+).
router.post("/push/subscribe", requireRole("viewer"), (req: Request, res: Response) => {
  if (!pushConfigured()) { res.status(501).json({ error: "push notifications are not configured on this deployment" }); return; }
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: "sign in to register for push" }); return; }
  const subscription = sanitizeSubscription(req.body?.subscription ?? req.body);
  if (!subscription) { res.status(400).json({ error: "a valid push subscription (allowed endpoint + keys) is required" }); return; }
  savePushSubscription(sub, subscription);
  res.status(201).json({ ok: true });
});

// POST /api/push/unsubscribe — drop this device's subscription (viewer+).
router.post("/push/unsubscribe", requireRole("viewer"), (req: Request, res: Response) => {
  const sub = callerSub(req);
  if (!sub) { res.status(401).json({ error: "sign in first" }); return; }
  const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : "";
  if (!endpoint) { res.status(400).json({ error: "endpoint is required" }); return; }
  removePushSubscription(sub, endpoint);
  res.status(204).end();
});

export default router;
