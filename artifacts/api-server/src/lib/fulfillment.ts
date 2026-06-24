/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import crypto from "node:crypto";
import { signLicense, LICENSE_FEATURES, type LicenseFeature, type LicensePayload } from "./license";
import { logger } from "./logger";

/**
 * Licence fulfilment — turn a verified purchase into a signed OmniProject
 * licence and deliver it. Stateless: the gateway holds no order database. On a
 * verified webhook it mints the Ed25519 licence (needs LICENSE_PRIVATE_KEY) and
 * POSTs it to an operator-configured fulfilment endpoint — typically an **n8n
 * workflow that emails the key to the buyer** (keeping n8n the backbone). The
 * minted key is also returned to the webhook caller for logging/echo.
 *
 * Product → entitlement mapping is config (env `LICENSE_PRODUCTS`, a JSON object
 * keyed by the provider's product/price id):
 *   {"price_abc":{"tier":"pro","features":["branding","labels"],"days":365},
 *    "ent_xyz":{"tier":"enterprise","features":["branding","labels","webhooks","enterprise_workflows"],"days":365}}
 */

export interface ProductEntitlement {
  tier: string;
  features: LicenseFeature[];
  days: number;
}

export interface PurchaseInput {
  provider: "stripe" | "gumroad";
  productId: string;
  customer: string; // email or name — what to stamp on the licence
  email?: string;
  orderId?: string;
  now?: number; // for tests
}

export interface FulfilResult {
  ok: boolean;
  reason?: string;
  licenseKey?: string;
  payload?: LicensePayload;
  delivered?: boolean;
  deliveryStatus?: number;
}

function productMap(): Record<string, ProductEntitlement> {
  const raw = process.env["LICENSE_PRODUCTS"]?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, { tier?: string; features?: unknown; days?: unknown }>;
    const out: Record<string, ProductEntitlement> = {};
    for (const [id, v] of Object.entries(parsed)) {
      const features = Array.isArray(v.features) ? LICENSE_FEATURES.filter((f) => (v.features as unknown[]).includes(f)) : [];
      out[id] = {
        tier: typeof v.tier === "string" ? v.tier : "licensed",
        features,
        days: typeof v.days === "number" && v.days > 0 ? v.days : 365,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Resolve the entitlement a purchased product grants, or null if unmapped. */
export function entitlementForProduct(productId: string): ProductEntitlement | null {
  return productMap()[productId] ?? null;
}

/** Mint a signed licence for a purchase (needs LICENSE_PRIVATE_KEY). */
export function mintForPurchase(input: PurchaseInput): { token: string; payload: LicensePayload } | { error: string } {
  const priv = process.env["LICENSE_PRIVATE_KEY"]?.trim();
  if (!priv) return { error: "LICENSE_PRIVATE_KEY not configured (cannot mint)" };
  const ent = entitlementForProduct(input.productId);
  if (!ent) return { error: `No entitlement mapping for product "${input.productId}" (set LICENSE_PRODUCTS)` };

  const iat = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: LicensePayload = {
    customer: input.customer || input.email || "Customer",
    tier: ent.tier,
    features: ent.features,
    iat,
    exp: iat + Math.round(ent.days * 86400),
  };
  try {
    return { token: signLicense(payload, priv), payload };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "minting failed" };
  }
}

/** POST the minted licence to the fulfilment endpoint (e.g. an n8n emailer). */
async function deliver(record: Record<string, unknown>): Promise<{ delivered: boolean; status?: number }> {
  const url = process.env["LICENSE_FULFILLMENT_URL"]?.trim();
  if (!url) return { delivered: false };
  const body = JSON.stringify(record);
  const secret = process.env["LICENSE_FULFILLMENT_SECRET"]?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers["X-OmniProject-Signature"] = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  try {
    const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) });
    return { delivered: r.ok, status: r.status };
  } catch {
    return { delivered: false };
  }
}

/** Verify-already-done: mint + deliver a licence for a purchase. */
export async function fulfilPurchase(input: PurchaseInput): Promise<FulfilResult> {
  const minted = mintForPurchase(input);
  if ("error" in minted) {
    logger.warn({ audit: true, action: "license_fulfilment", provider: input.provider, productId: input.productId, result: "error", reason: minted.error }, "license_fulfilment_failed");
    return { ok: false, reason: minted.error };
  }
  const delivery = await deliver({
    licenseKey: minted.token,
    customer: minted.payload.customer,
    email: input.email ?? null,
    tier: minted.payload.tier,
    features: minted.payload.features,
    expiresAt: minted.payload.exp ? new Date(minted.payload.exp * 1000).toISOString() : null,
    provider: input.provider,
    orderId: input.orderId ?? null,
  });
  logger.info(
    { audit: true, action: "license_fulfilment", provider: input.provider, productId: input.productId, tier: minted.payload.tier, delivered: delivery.delivered, result: "success" },
    "license_fulfilment",
  );
  return { ok: true, licenseKey: minted.token, payload: minted.payload, delivered: delivery.delivered, deliveryStatus: delivery.status };
}
