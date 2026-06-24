import crypto from "node:crypto";

/**
 * Licensing / entitlements — the paywall for premium overlay features.
 *
 * OmniProject stays stateless: entitlements are NOT a billing database. They are
 * carried by a **time-limited, signed license key** supplied via config/env
 * (`LICENSE_KEY`). The key is an Ed25519-signed token issued by the vendor; the
 * deployment verifies it against the vendor's public key (`LICENSE_PUBLIC_KEY`,
 * or a bundled default) — it cannot be forged or extended without the private
 * key, and it stops granting features once `exp` passes. When the licence lapses
 * the premium features revert to their free defaults automatically.
 *
 * Premium features gated here:
 *   - branding  — white-label the UI (app name, logo, colours, login/footer text)
 *   - labels    — override field/term labels for company nomenclature
 *   - webhooks  — outbound event push (OmniProject → bus / SIEM / customer URL)
 *
 * Uses only Node's crypto (Ed25519 sign/verify) — no new dependencies. The same
 * primitives mint a licence in `scripts/mint-license.ts` for issuers/tests.
 */

export const LICENSE_FEATURES = ["branding", "labels", "webhooks"] as const;
export type LicenseFeature = (typeof LICENSE_FEATURES)[number];

export interface LicensePayload {
  /** Customer / deployment this licence was issued to (free-form). */
  customer: string;
  /** Marketing tier label, e.g. "professional" | "enterprise". */
  tier: string;
  /** Entitled features. Unknown entries are ignored. */
  features: LicenseFeature[];
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). A licence with no exp never expires. */
  exp?: number;
}

export interface LicenseStatus {
  valid: boolean;
  /** Where the entitlements came from. */
  source: "license" | "dev" | "none";
  tier: string;
  customer: string | null;
  features: LicenseFeature[];
  /** Expiry ISO string, if any. */
  expiresAt: string | null;
  /** Whole days until expiry (negative once expired), or null when none. */
  expiresInDays: number | null;
  /** Why the licence is invalid / which fallback applied. */
  reason: string | null;
}

const TOKEN_PREFIX = "omni-lic.v1";

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

/** Resolve a PEM public/private key from an env value (raw PEM or base64 of PEM). */
function resolvePem(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v.includes("BEGIN")) return v;
  try {
    const decoded = Buffer.from(v, "base64").toString("utf8");
    return decoded.includes("BEGIN") ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Sign a licence payload with an Ed25519 private key (PEM). Used by the minting
 * script and by tests; the running gateway only ever *verifies*.
 */
export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64urlJson(payload);
  const signingInput = `${TOKEN_PREFIX}.${body}`;
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(signingInput), key).toString("base64url");
  return `${signingInput}.${sig}`;
}

export interface VerifyResult {
  valid: boolean;
  reason: string | null;
  payload: LicensePayload | null;
}

/** Verify a licence token's signature + expiry against an Ed25519 public key. */
export function verifyLicense(token: string, publicKeyPem: string, now = Date.now()): VerifyResult {
  const parts = token.trim().split(".");
  // prefix has a dot ("omni-lic.v1"), so a valid token is: omni-lic . v1 . body . sig
  if (parts.length !== 4 || `${parts[0]}.${parts[1]}` !== TOKEN_PREFIX) {
    return { valid: false, reason: "malformed licence token", payload: null };
  }
  const body = parts[2];
  const sigB64 = parts[3];
  const signingInput = `${TOKEN_PREFIX}.${body}`;

  let key: crypto.KeyObject;
  try {
    key = crypto.createPublicKey(publicKeyPem);
  } catch {
    return { valid: false, reason: "invalid licence public key", payload: null };
  }

  let okSig = false;
  try {
    okSig = crypto.verify(null, Buffer.from(signingInput), key, Buffer.from(sigB64, "base64url"));
  } catch {
    okSig = false;
  }
  if (!okSig) return { valid: false, reason: "signature verification failed", payload: null };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LicensePayload;
  } catch {
    return { valid: false, reason: "unreadable licence payload", payload: null };
  }

  if (typeof payload.exp === "number" && now / 1000 > payload.exp) {
    return { valid: false, reason: "licence expired", payload };
  }
  return { valid: true, reason: null, payload };
}

/**
 * Bundled vendor public key. A real distribution embeds the vendor's published
 * Ed25519 public key here so vendor-issued licences verify out of the box. Left
 * empty in the open repo — set `LICENSE_PUBLIC_KEY` to your issuing key.
 */
const BUNDLED_PUBLIC_KEY = "";

function publicKey(): string | null {
  return resolvePem(process.env["LICENSE_PUBLIC_KEY"]) ?? (BUNDLED_PUBLIC_KEY || null);
}

function isProd(): boolean {
  return process.env["NODE_ENV"] === "production";
}

function devFeatures(): LicenseFeature[] {
  // Non-production escape hatch so developers can exercise premium UI without a
  // real licence. Ignored in production — premium stays paywalled there.
  if (isProd()) return [];
  const raw = process.env["LICENSE_DEV_FEATURES"]?.trim();
  if (!raw) return [];
  const set = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  if (set.has("all") || set.has("*")) return [...LICENSE_FEATURES];
  return LICENSE_FEATURES.filter((f) => set.has(f));
}

function sanitizeFeatures(input: unknown): LicenseFeature[] {
  if (!Array.isArray(input)) return [];
  return LICENSE_FEATURES.filter((f) => input.includes(f));
}

/** Resolve current entitlements from env/config. Pure w.r.t. the supplied `now`. */
export function resolveLicense(now = Date.now()): LicenseStatus {
  const token = process.env["LICENSE_KEY"]?.trim();
  const pub = publicKey();

  if (token) {
    if (!pub) {
      return base("none", { reason: "LICENSE_KEY set but no LICENSE_PUBLIC_KEY to verify it" });
    }
    const result = verifyLicense(token, pub, now);
    if (result.valid && result.payload) {
      const p = result.payload;
      const exp = typeof p.exp === "number" ? p.exp : null;
      return {
        valid: true,
        source: "license",
        tier: typeof p.tier === "string" ? p.tier : "licensed",
        customer: typeof p.customer === "string" ? p.customer : null,
        features: sanitizeFeatures(p.features),
        expiresAt: exp ? new Date(exp * 1000).toISOString() : null,
        expiresInDays: exp ? Math.floor((exp * 1000 - now) / 86_400_000) : null,
        reason: null,
      };
    }
    // Invalid/expired licence → fall through to dev/none, but report why.
    const dev = devFeatures();
    if (dev.length) return base("dev", { features: dev, tier: "dev", reason: result.reason });
    return base("none", { reason: result.reason });
  }

  const dev = devFeatures();
  if (dev.length) return base("dev", { features: dev, tier: "dev", reason: "LICENSE_DEV_FEATURES (non-production)" });
  return base("none", { reason: "no licence configured" });
}

function base(
  source: LicenseStatus["source"],
  over: Partial<LicenseStatus> & { features?: LicenseFeature[] } = {},
): LicenseStatus {
  return {
    valid: source !== "none",
    source,
    tier: over.tier ?? (source === "none" ? "community" : source),
    customer: over.customer ?? null,
    features: over.features ?? [],
    expiresAt: over.expiresAt ?? null,
    expiresInDays: over.expiresInDays ?? null,
    reason: over.reason ?? null,
  };
}

/** Is a premium feature currently entitled? */
export function isEntitled(feature: LicenseFeature, now = Date.now()): boolean {
  return resolveLicense(now).features.includes(feature);
}

/** A safe summary for the UI / status endpoints (no signature material). */
export function licenseSummary(now = Date.now()): LicenseStatus & { catalog: LicenseFeature[] } {
  return { ...resolveLicense(now), catalog: [...LICENSE_FEATURES] };
}

/** Express middleware: 402 Payment Required unless `feature` is entitled. */
export function requireEntitlement(feature: LicenseFeature) {
  return (_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void => {
    if (isEntitled(feature)) {
      next();
      return;
    }
    res.status(402).json({
      error: `"${feature}" is a licensed feature. Add a valid LICENSE_KEY to enable it.`,
      feature,
      license: resolveLicense(),
    });
  };
}
