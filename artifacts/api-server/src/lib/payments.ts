/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by LICENSE-PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import crypto from "node:crypto";

/**
 * Payment-provider webhook signature verification (Stripe + Gumroad).
 *
 * Pure + side-effect free so the crypto is unit-tested. The route layer
 * (routes/licensing.ts) wires these to the raw request body and then mints a
 * signed OmniProject licence on a verified purchase (lib/fulfillment.ts).
 */

export interface VerifyOutcome {
  ok: boolean;
  reason?: string;
}

/**
 * Verify a Stripe webhook signature.
 * Header form: `t=<unix>,v1=<hexHmac>[,v1=<hexHmac>…]`; the signed payload is
 * `"<t>.<rawBody>"` HMAC-SHA256'd with the endpoint's signing secret.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  opts: { now?: number; toleranceSec?: number } = {},
): VerifyOutcome {
  if (!secret) return { ok: false, reason: "no STRIPE_WEBHOOK_SECRET configured" };
  if (!signatureHeader) return { ok: false, reason: "missing Stripe-Signature header" };

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = parts["t"];
  // A Stripe-Signature header can carry SEVERAL v1 signatures during a secret
  // rotation (old + new). Collect them all and accept if ANY matches — the
  // Object.fromEntries above would have kept only the last, so re-parse here.
  const v1 = signatureHeader
    .split(",")
    .map((kv) => kv.split("="))
    .filter(([k]) => k.trim() === "v1")
    .map(([, v]) => v.trim());
  if (!t || v1.length === 0) return { ok: false, reason: "malformed Stripe-Signature" };

  const tolerance = opts.toleranceSec ?? 300;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(t)) > tolerance) return { ok: false, reason: "timestamp outside tolerance" };

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expBuf = Buffer.from(expected);
  const match = v1.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  });
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

/**
 * Verify a Gumroad "ping" / resource-subscription POST. Gumroad does not HMAC
 * its pings, so authenticity is established by (a) a shared secret token the
 * operator appends to the configured ping URL (`?token=…` or a body field), and
 * optionally (b) matching the seller_id. Both are constant-time compared.
 */
export function verifyGumroad(
  params: Record<string, string>,
  providedToken: string | undefined,
  opts: { secret?: string; sellerId?: string },
): VerifyOutcome {
  if (!opts.secret) return { ok: false, reason: "no GUMROAD_WEBHOOK_SECRET configured" };
  const token = providedToken ?? params["token"];
  if (!token) return { ok: false, reason: "missing shared-secret token" };
  const a = Buffer.from(token);
  const b = Buffer.from(opts.secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "token mismatch" };

  if (opts.sellerId && params["seller_id"] && params["seller_id"] !== opts.sellerId) {
    return { ok: false, reason: "seller_id mismatch" };
  }
  return { ok: true };
}
