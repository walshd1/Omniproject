import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { deriveKeyCached } from "./crypto-keys";

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

function key(): Buffer {
  return deriveKeyCached(process.env["SESSION_SECRET"]?.trim() || DEV_SECRET);
}

/** Encrypt + authenticate a string. Returns a versioned base64url token. */
export function seal(plaintext: string): string {
  return PREFIX + aesGcmSeal(plaintext, key());
}

/** Decrypt + verify. Returns null on a non-sealed value, tamper, or wrong key —
 *  never throws, so callers treat any failure as "no session". */
export function open(token: string): string | null {
  if (typeof token !== "string" || !token.startsWith(PREFIX)) return null;
  return aesGcmOpen(token.slice(PREFIX.length), key());
}

export const SEALED_PREFIX = PREFIX;
