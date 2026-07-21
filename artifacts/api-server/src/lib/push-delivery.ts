import type { NotifyEnvelope } from "./notify-bus";
import type { NotifyTarget } from "./notify-hub";
import { isFeatureEnabled } from "./feature-modules";
import { pushConfigured, sendPush, type PushPayload, type PushResult, type StoredSubscription } from "./web-push";
import { listPushSubscriptions, removePushSubscriptionById } from "./push-subscriptions";

/**
 * Browser Web Push delivery for a notification (roadmap 2.5 slice 3) — the effect the notify bus fires ONCE,
 * on the origin replica, alongside the in-app SSE fan-out. Best-effort and fully gated: it does nothing
 * unless the `pushNotifications` module is enabled AND VAPID keys are configured. Only PERSONAL notifications
 * (addressed to a specific `sub`) push to a device; broadcasts stay on SSE / the external channels. An
 * expired subscription (404/410 from the push service) is pruned so it isn't retried.
 */

const targetSub = (t?: NotifyTarget): string | undefined => (typeof t?.sub === "string" && t.sub ? t.sub : undefined);

/** Build the compact push payload from a notification, or null when there's nothing to show (no title). */
export function toPushPayload(notification: unknown): PushPayload | null {
  if (!notification || typeof notification !== "object") return null;
  const o = notification as Record<string, unknown>;
  const title = typeof o["title"] === "string" ? o["title"] : "";
  if (!title) return null;
  const payload: PushPayload = { title };
  if (typeof o["body"] === "string") payload.body = o["body"];
  if (typeof o["url"] === "string") payload.url = o["url"];
  if (typeof o["id"] === "string") payload.tag = o["id"]; // collapse repeats of the same notification
  return payload;
}

/** The send function shape (injectable for tests; defaults to the real {@link sendPush}). */
type Sender = (subscription: StoredSubscription, payload: PushPayload) => Promise<PushResult>;

/** Fan a notification out to the target user's registered devices via Web Push (best-effort, prunes dead subs). */
export async function deliverWebPush(env: NotifyEnvelope, send: Sender = sendPush): Promise<void> {
  if (!isFeatureEnabled("pushNotifications") || !pushConfigured()) return;
  const sub = targetSub(env.target);
  if (!sub) return; // only personal notifications push; broadcasts stay on SSE / channels
  const payload = toPushPayload(env.notification);
  if (!payload) return;
  for (const s of listPushSubscriptions(sub)) {
    const res = await send({ endpoint: s.endpoint, keys: s.keys }, payload);
    if (!res.ok && res.gone) removePushSubscriptionById(sub, s.id);
  }
}
