import webpush from "web-push";

/**
 * BROWSER WEB PUSH delivery (roadmap 2.5 slice 3) — an additional notification channel that reaches a user's
 * device even when the PWA is closed, on top of the existing in-app SSE + external channels. Uses the MIT
 * `web-push` library for the VAPID (RFC 8292) + payload encryption (RFC 8291) protocol.
 *
 * SECURITY / EGRESS: a push subscription's `endpoint` is a URL the browser's push service minted — we send
 * an (encrypted) POST to it. To bound outbound egress (SSRF), we ONLY send to the KNOWN push-service hosts
 * ({@link isAllowedPushEndpoint}); anything else is refused. The feature is inert unless VAPID keys are
 * configured (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT), and it's gated behind the default-off
 * `pushNotifications` module — so an operator opts in, and no data leaves without configured keys.
 */

export interface VapidConfig { publicKey: string; privateKey: string; subject: string }

/** The configured VAPID keypair + contact subject, or null when not fully configured (push stays inert). */
export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env["VAPID_PUBLIC_KEY"]?.trim();
  const privateKey = process.env["VAPID_PRIVATE_KEY"]?.trim();
  const subject = process.env["VAPID_SUBJECT"]?.trim() || "mailto:admin@omniproject.local";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

/** Whether browser Web Push can actually send (VAPID keys are configured). */
export const pushConfigured = (): boolean => vapidConfig() !== null;

/** The public VAPID key the client needs for `pushManager.subscribe`, or null when unconfigured. */
export const vapidPublicKey = (): string | null => vapidConfig()?.publicKey ?? null;

/**
 * The push-service host suffixes we permit as egress destinations. A subscription endpoint host must END WITH
 * one of these — bounding outbound sends to the real push services (Chrome/FCM, Firefox, Edge/Windows,
 * Safari/Apple) and refusing an attacker-supplied endpoint pointed at an internal host.
 */
export const PUSH_ENDPOINT_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
] as const;

/** Whether an endpoint URL is https and targets a known push service (SSRF bound). */
export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string") return false;
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return PUSH_ENDPOINT_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** The minimal subscription shape we store + send to (a browser `PushSubscription`). */
export interface StoredSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** The compact, human-facing payload a push delivers (rendered by the service-worker `push` handler). */
export interface PushPayload { title: string; body?: string; url?: string; tag?: string }

/** The outcome of a send: ok, or failed with the status (`gone` ⇒ the subscription is dead → prune it). */
export type PushResult = { ok: true } | { ok: false; statusCode?: number; gone: boolean };

/** Map a push-service HTTP status to a failure result. 404/410 ⇒ the subscription has expired (`gone`). Pure. */
export function classifyPushError(statusCode: number | undefined): Extract<PushResult, { ok: false }> {
  const gone = statusCode === 404 || statusCode === 410;
  return statusCode === undefined ? { ok: false, gone } : { ok: false, statusCode, gone };
}

/**
 * Send one encrypted Web Push. No-op-refuses when unconfigured or the endpoint isn't an allowed push host.
 * A 404/410 from the push service means the subscription has expired (`gone: true`) so the caller prunes it.
 */
export async function sendPush(subscription: StoredSubscription, payload: PushPayload): Promise<PushResult> {
  const vapid = vapidConfig();
  if (!vapid) return { ok: false, gone: false };
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { ok: false, gone: false };
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: vapid,
      TTL: 60 * 60, // hold up to an hour if the device is offline
    });
    return { ok: true };
  } catch (err) {
    return classifyPushError((err as { statusCode?: number }).statusCode);
  }
}
