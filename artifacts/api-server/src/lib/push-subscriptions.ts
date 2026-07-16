import crypto from "node:crypto";
import { listArtifacts, getArtifact, putArtifact, deleteArtifact, type ArtifactScope } from "./artifact-store";
import { isAllowedPushEndpoint, type StoredSubscription } from "./web-push";

/**
 * Per-user browser push SUBSCRIPTIONS (roadmap 2.5 slice 3), held in the scoped, AES-256-GCM-sealed
 * artifact store (zero-at-rest) under each user's private area — a subscription's endpoint URL is sensitive,
 * so it's encrypted at rest like every other user-held artifact. A user may have several (one per device);
 * each is keyed by a hash of its endpoint. The delivery path loads a user's subscriptions by `sub` (detached
 * from any request), so this store is the shared source of truth.
 */

export const PUSH_SUBSCRIPTION_ARTIFACT = "push-subscription";
const MAX_KEY_LEN = 256;
const MAX_ENDPOINT_LEN = 2000;

/** A stored subscription row (an artifact needs a string `id`). */
export interface PushSubscriptionRow extends StoredSubscription { id: string; at: string }

/** Stable id for a subscription — a short hash of its endpoint (so re-subscribing the same device upserts). */
export const subscriptionId = (endpoint: string): string => `sub-${crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 24)}`;

const userScope = (sub: string): ArtifactScope => ({ kind: "user", sub });

/** Validate + normalise a raw client subscription, or null when malformed / not an allowed push endpoint. */
export function sanitizeSubscription(raw: unknown): StoredSubscription | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const endpoint = typeof obj["endpoint"] === "string" ? obj["endpoint"].trim() : "";
  if (!endpoint || endpoint.length > MAX_ENDPOINT_LEN || !isAllowedPushEndpoint(endpoint)) return null;
  const keys = obj["keys"];
  if (!keys || typeof keys !== "object") return null;
  const k = keys as Record<string, unknown>;
  const p256dh = typeof k["p256dh"] === "string" ? k["p256dh"] : "";
  const auth = typeof k["auth"] === "string" ? k["auth"] : "";
  if (!p256dh || !auth || p256dh.length > MAX_KEY_LEN || auth.length > MAX_KEY_LEN) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Upsert a subscription into the caller's private area. */
export function savePushSubscription(sub: string, subscription: StoredSubscription, now = new Date().toISOString()): PushSubscriptionRow {
  const row: PushSubscriptionRow = { id: subscriptionId(subscription.endpoint), endpoint: subscription.endpoint, keys: subscription.keys, at: now };
  putArtifact(PUSH_SUBSCRIPTION_ARTIFACT, userScope(sub), row);
  return row;
}

/** Every subscription a user currently has registered (across their devices). */
export function listPushSubscriptions(sub: string): PushSubscriptionRow[] {
  return listArtifacts<PushSubscriptionRow>(PUSH_SUBSCRIPTION_ARTIFACT, userScope(sub));
}

/** Remove a subscription by its endpoint; returns whether it was present. */
export function removePushSubscription(sub: string, endpoint: string): boolean {
  return deleteArtifact(PUSH_SUBSCRIPTION_ARTIFACT, userScope(sub), subscriptionId(endpoint));
}

/** Remove a subscription by its stored id (used by the delivery path to prune a dead/expired endpoint). */
export function removePushSubscriptionById(sub: string, id: string): boolean {
  return deleteArtifact(PUSH_SUBSCRIPTION_ARTIFACT, userScope(sub), id);
}

/** One subscription by endpoint, or null. */
export function getPushSubscription(sub: string, endpoint: string): PushSubscriptionRow | null {
  return getArtifact<PushSubscriptionRow>(PUSH_SUBSCRIPTION_ARTIFACT, userScope(sub), subscriptionId(endpoint));
}
