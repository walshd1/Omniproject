import { getJson, sendJson } from "./api";

/**
 * Browser-side Web Push subscription helper (roadmap 2.5 slice 3). Talks to routes/push.ts:
 * fetch the server's public VAPID key, ask the browser's PushManager for a subscription, and register
 * (or drop) it server-side. Everything here FEATURE-detects — a browser without a service worker or the
 * Push API simply reports unsupported, and callers stay inert. No network is touched until the user opts in.
 */

/** Whether this browser can do Web Push at all (service worker + PushManager + Notification). */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current OS/browser permission for notifications ("default" | "granted" | "denied"), or "unsupported". */
export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/** VAPID public keys are URL-safe base64; the PushManager needs the raw bytes as a Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** A browser PushSubscription serialised to the shape routes/push.ts accepts ({endpoint, keys}). */
function serialiseSubscription(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/**
 * Subscribe this device to Web Push and register it with the server. Prompts for the notification
 * permission if it hasn't been decided. Returns true on success. Throws only on an unexpected server error;
 * a denied permission or an unconfigured deployment resolves to false so the caller can reflect that in the UI.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return false;

  // The server only hands out a key when VAPID is configured; a 501 means push is off for this deployment.
  let publicKey: string;
  try {
    publicKey = (await getJson<{ publicKey: string }>("/api/push/vapid-key")).publicKey;
  } catch {
    return false;
  }
  if (!publicKey) return false;

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource }));

  const payload = serialiseSubscription(sub);
  if (!payload) return false;
  await sendJson("/api/push/subscribe", { subscription: payload }, "POST");
  return true;
}

/** Drop this device's push subscription (browser-side and server-side). Best-effort; never throws. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await sendJson("/api/push/unsubscribe", { endpoint }, "POST").catch(() => {});
  } catch {
    /* best-effort */
  }
}
