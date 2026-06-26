import crypto from "node:crypto";

/**
 * Authenticated encryption for the session cookie.
 *
 * The session payload carries the user's OIDC access token and identity claims.
 * Today the cookie is HMAC-*signed* (tamper-proof) but its JSON is *readable*; if
 * the cookie ever leaks (a logging proxy, a browser memory dump, an XSS despite
 * HttpOnly), the bearer token is exposed. Sealing it with AES-256-GCM means a
 * leaked cookie is opaque ciphertext, and any tampering fails the auth tag.
 *
 * Key = SHA-256(SESSION_SECRET) — the secret is already high-entropy and required
 * to be strong in production (app.ts fails fast on a default). Read lazily so
 * tests and key rotation take effect without a restart.
 */

const PREFIX = "v1."; // version marker so the format can evolve / migrate
const DEV_SECRET = "omniproject-dev-secret-change-in-production";

let cache: { secret: string; key: Buffer } | null = null;
function key(): Buffer {
  const secret = process.env["SESSION_SECRET"]?.trim() || DEV_SECRET;
  if (!cache || cache.secret !== secret) {
    cache = { secret, key: crypto.createHash("sha256").update(secret).digest() };
  }
  return cache.key;
}

/** Encrypt + authenticate a string. Returns a versioned base64url token. */
export function seal(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

/** Decrypt + verify. Returns null on a non-sealed value, tamper, or wrong key —
 *  never throws, so callers treat any failure as "no session". */
export function open(token: string): string | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  try {
    const buf = Buffer.from(token.slice(PREFIX.length), "base64url");
    if (buf.length < 28) return null; // 12 IV + 16 tag minimum
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const SEALED_PREFIX = PREFIX;
