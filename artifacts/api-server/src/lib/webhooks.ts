/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import crypto from "node:crypto";
import { getSettings, updateSettings, type WebhookSubscription } from "./settings";
import { assertSafeOutboundUrl } from "./url-safety";
import { safeFetch, EgressError } from "./egress";
import { isEntitled } from "./license";
import { logger } from "./logger";
import { isTimeoutError } from "./timeout-error";
import {
  OUTBOUND_EVENT_NAMES,
  OUTBOUND_HEADERS,
  SIGNATURE_SCHEME,
  type OutboundEvent,
  type OutboundEventName,
} from "../broker/contract";

/**
 * Outbound webhooks (premium feature `webhooks`).
 *
 * OmniProject can push events out — to a customer endpoint, a SIEM, Slack, or an
 * n8n webhook node (letting the reference broker act as one integration backbone
 * among several targets). Each subscription
 * has a signing secret; deliveries carry an HMAC-SHA256 signature so the
 * receiver can verify authenticity.
 *
 * Stateless + fire-and-forget: there is no durable delivery queue (that would be
 * application state). One attempt with a short timeout; the outcome is logged
 * for audit. For at-least-once delivery, point a webhook at an n8n webhook node
 * and let n8n's queue handle retries.
 */

// The canonical event vocabulary lives in the broker contract; re-exported here
// under the historical names so the rest of the gateway keeps importing it from
// lib/webhooks.
export const WEBHOOK_EVENTS = OUTBOUND_EVENT_NAMES;
export type WebhookEvent = OutboundEventName;

/** A subscription with its secret redacted, safe to return to the browser. */
export interface RedactedSubscription extends Omit<WebhookSubscription, "secret"> {
  secretSet: boolean;
}

function subs(): WebhookSubscription[] {
  return getSettings().webhooks ?? [];
}

/** Strip the signing secret from a subscription for safe display (keeps a `secretSet` flag). */
export function redact(s: WebhookSubscription): RedactedSubscription {
  const { secret, ...rest } = s;
  return { ...rest, secretSet: !!secret };
}

/** All configured webhook subscriptions, secret-redacted. */
export function listWebhooks(): RedactedSubscription[] {
  return subs().map(redact);
}

/** Thrown when a webhook subscription id doesn't exist (delete/test). */
export class WebhookNotFoundError extends Error {
  constructor(message = "Unknown webhook id") {
    super(message);
    this.name = "WebhookNotFoundError";
  }
}

/**
 * Validate a webhook create request and build the subscription record (including a freshly
 * minted id + signing secret). Pure — throws on bad input, never touches settings. Split from
 * `createWebhook` so validation/construction and persistence are two separate, testable steps.
 */
function parseWebhookInput(input: unknown): WebhookSubscription {
  if (!input || typeof input !== "object") throw new Error("webhook must be an object");
  const o = input as Record<string, unknown>;
  const url = String(o["url"] ?? "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("url must be an absolute http(s) URL");
  // Same SSRF guard as the broker/logging-sync URLs: reject cloud-metadata/link-local targets.
  assertSafeOutboundUrl(url, "webhook url");

  const events = Array.isArray(o["events"]) && o["events"].length
    ? (o["events"] as unknown[]).map(String).filter((e) => e === "*" || (WEBHOOK_EVENTS as readonly string[]).includes(e))
    : ["*"];
  if (!events.length) throw new Error("events must include '*' or a known event name");

  const secret = typeof o["secret"] === "string" && o["secret"].trim()
    ? o["secret"].trim()
    : crypto.randomBytes(24).toString("base64url");

  return {
    id: crypto.randomUUID(),
    url,
    secret,
    events,
    active: o["active"] !== false,
    description: typeof o["description"] === "string" ? o["description"].slice(0, 200) : undefined,
  };
}

/**
 * Validate + create a subscription. Returns the full record INCLUDING the
 * plaintext secret so the caller can reveal it once at creation time; list/get
 * never expose it again. Throws on bad input.
 */
export function createWebhook(input: unknown): WebhookSubscription {
  const sub = parseWebhookInput(input);
  updateSettings({ webhooks: [...subs(), sub] });
  return sub;
}

/** Remove a subscription by id. Throws WebhookNotFoundError if no such subscription existed —
 *  matching createWebhook's throw-on-bad-input convention rather than a sentinel return. */
export function deleteWebhook(id: string): void {
  const next = subs().filter((s) => s.id !== id);
  if (next.length === subs().length) throw new WebhookNotFoundError();
  updateSettings({ webhooks: next });
}

/** The full subscription (incl. secret) by id, for internal delivery use. */
export function getWebhook(id: string): WebhookSubscription | undefined {
  return subs().find((s) => s.id === id);
}

function matches(sub: WebhookSubscription, event: WebhookEvent): boolean {
  return sub.active && (sub.events.includes("*") || sub.events.includes(event));
}

export interface DeliveryResult {
  id: string;
  url: string;
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}

/** Sign a serialized body with a subscription secret (HMAC-SHA256, hex). */
export function signBody(body: string, secret: string): string {
  return `${SIGNATURE_SCHEME}=${crypto.createHmac(SIGNATURE_SCHEME, secret).update(body).digest("hex")}`;
}

async function deliverOne(sub: WebhookSubscription, event: WebhookEvent, payload: unknown, ts: string): Promise<DeliveryResult> {
  const deliveryId = crypto.randomUUID();
  const envelope: OutboundEvent = { event, deliveredAt: ts, deliveryId, data: payload };
  const body = JSON.stringify(envelope);
  const started = Date.now();
  try {
    // safeFetch re-validates the target at DELIVERY time (incl. a fresh DNS resolution), not
    // just once at subscription-creation time — a subscription's URL is admin/customer-supplied
    // and can sit unused for a long time, during which its DNS record (or the record of a domain
    // it's since been repointed to) could be rebound to a link-local/metadata address. Re-checking
    // on every delivery closes that TOCTOU/DNS-rebinding gap.
    const r = await safeFetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OmniProject-Webhook/1",
        [OUTBOUND_HEADERS.event]: event,
        [OUTBOUND_HEADERS.delivery]: deliveryId,
        [OUTBOUND_HEADERS.signature]: signBody(body, sub.secret),
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return { id: sub.id, url: sub.url, ok: r.ok, status: r.status, ms: Date.now() - started };
  } catch (err) {
    const isTimeout = isTimeoutError(err);
    const error = err instanceof EgressError ? "blocked by egress policy" : isTimeout ? "timed out" : "unreachable";
    return { id: sub.id, url: sub.url, ok: false, status: 0, ms: Date.now() - started, error };
  }
}

/**
 * Fan an event out to all matching subscriptions. No-op (returns []) unless the
 * `webhooks` entitlement is active. Fire-and-forget at the call site.
 */
export async function deliverWebhooks(event: WebhookEvent, payload: unknown): Promise<DeliveryResult[]> {
  if (!isEntitled("webhooks")) return [];
  const targets = subs().filter((s) => matches(s, event));
  if (!targets.length) return [];
  const ts = new Date().toISOString();
  const results = await Promise.all(targets.map((s) => deliverOne(s, event, payload, ts)));
  for (const r of results) {
    logger.info(
      { audit: true, action: "webhook_delivery", event, webhookId: r.id, url: r.url, ok: r.ok, status: r.status, ms: r.ms, result: r.ok ? "success" : "error" },
      "webhook_delivery",
    );
  }
  return results;
}

/** Deliver an event without awaiting (so the request path isn't blocked). */
export function emitWebhookEvent(event: WebhookEvent, payload: unknown): void {
  void deliverWebhooks(event, payload).catch((err) => logger.warn({ err, event }, "webhook fan-out failed"));
}

/** Send a single test event to one subscription (ignores active/event filters). Throws
 *  WebhookNotFoundError if no such subscription existed. */
export async function testWebhook(id: string): Promise<DeliveryResult> {
  const sub = getWebhook(id);
  if (!sub) throw new WebhookNotFoundError();
  return deliverOne(sub, "webhook.test", { message: "Test event from OmniProject", webhookId: id }, new Date().toISOString());
}