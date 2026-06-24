/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router, type Request } from "express";
import { verifyStripeSignature, verifyGumroad } from "../lib/payments";
import { fulfilPurchase } from "../lib/fulfillment";
import { logger } from "../lib/logger";

/**
 * Payment-provider webhooks → automated licence fulfilment.
 *
 * Public (the provider calls them, not a user session); authenticated by the
 * provider's own signature/secret, then mints + delivers a signed licence.
 * Stateless — no order database; delivery goes to LICENSE_FULFILLMENT_URL
 * (e.g. an n8n workflow that emails the buyer their key).
 *
 *  - POST /api/licensing/stripe   — Stripe webhook (checkout.session.completed)
 *  - POST /api/licensing/gumroad  — Gumroad ping (sale)
 */
const router = Router();

function rawBody(req: Request): string {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw ? raw.toString("utf8") : JSON.stringify(req.body ?? {});
}

// ── Stripe ───────────────────────────────────────────────────────────────────
router.post("/licensing/stripe", async (req, res) => {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"]?.trim() ?? "";
  const sig = req.headers["stripe-signature"];
  const v = verifyStripeSignature(rawBody(req), Array.isArray(sig) ? sig[0] : sig, secret);
  if (!v.ok) {
    logger.warn({ action: "stripe_webhook", result: "rejected", reason: v.reason }, "stripe_webhook_rejected");
    res.status(400).json({ error: `Stripe signature rejected: ${v.reason}` });
    return;
  }

  const event = (req.body ?? {}) as { type?: string; data?: { object?: Record<string, unknown> } };
  // Only act on a completed purchase; acknowledge everything else.
  if (event.type !== "checkout.session.completed" && event.type !== "invoice.paid") {
    res.json({ received: true, ignored: true, type: event.type ?? null });
    return;
  }

  const obj = event.data?.object ?? {};
  const metadata = (obj["metadata"] as Record<string, string> | undefined) ?? {};
  // Operator sets `license_product` on the Checkout Session / Payment Link to
  // map the purchase onto an entitlement (see LICENSE_PRODUCTS).
  const productId = metadata["license_product"] || metadata["product"] || String(obj["client_reference_id"] ?? "");
  const email = String((obj["customer_details"] as Record<string, unknown> | undefined)?.["email"] ?? obj["customer_email"] ?? "");
  const customer = String((obj["customer_details"] as Record<string, unknown> | undefined)?.["name"] ?? email ?? "Customer");

  const result = await fulfilPurchase({ provider: "stripe", productId, customer, email, orderId: String(obj["id"] ?? "") });
  // Always 200 once the signature is valid so Stripe doesn't retry a config error.
  res.json({ received: true, fulfilled: result.ok, delivered: result.delivered ?? false, error: result.ok ? undefined : result.reason });
});

// ── Gumroad ──────────────────────────────────────────────────────────────────
router.post("/licensing/gumroad", async (req, res) => {
  const secret = process.env["GUMROAD_WEBHOOK_SECRET"]?.trim();
  const sellerId = process.env["GUMROAD_SELLER_ID"]?.trim();
  const params = (req.body ?? {}) as Record<string, string>;
  const token = (req.query["token"] as string | undefined) ?? params["token"];
  const v = verifyGumroad(params, token, { secret, sellerId });
  if (!v.ok) {
    logger.warn({ action: "gumroad_webhook", result: "rejected", reason: v.reason }, "gumroad_webhook_rejected");
    res.status(400).json({ error: `Gumroad ping rejected: ${v.reason}` });
    return;
  }

  // Ignore refunds/disputes/chargebacks — only a live sale grants a licence.
  if (params["refunded"] === "true" || params["disputed"] === "true" || params["chargebacked"] === "true") {
    res.json({ received: true, ignored: true, reason: "not an active sale" });
    return;
  }

  const productId = params["product_permalink"] || params["product_id"] || params["product_name"] || "";
  const email = params["email"] ?? "";
  const result = await fulfilPurchase({ provider: "gumroad", productId, customer: email || "Customer", email, orderId: params["sale_id"] });
  res.json({ received: true, fulfilled: result.ok, delivered: result.delivered ?? false, error: result.ok ? undefined : result.reason });
});

export default router;
