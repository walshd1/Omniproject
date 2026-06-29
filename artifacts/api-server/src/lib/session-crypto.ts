import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { deriveKey, deriveKeyCached } from "./crypto-keys";

/**
 * Authenticated encryption for the session cookie.
 *
 * The session payload carries the user's OIDC access token and identity claims.
 * Today the cookie is HMAC-*signed* (tamper-proof) but its JSON is *readable*; if
 * the cookie ever leaks (a logging proxy, a browser memory dump, an XSS despite
 * HttpOnly), the bearer token is exposed. Sealing it with AES-256-GCM means a
 * leaked cookie is opaque ciphertext, and any tampering fails the auth tag.
 *
 * Key = HKDF-SHA256(SESSION_SECRET, info="omniproject/session") — the secret is
 * already high-entropy and required to be strong in production (app.ts fails fast
 * on a default); HKDF adds a purpose-built KDF and domain separation. Read lazily
 * so tests and key rotation take effect without a restart.
 *
 * Backward compatibility: new cookies are sealed under "v2." (HKDF). Cookies sealed
 * by an earlier release carry "v1." (legacy SHA-256) and are still opened with the
 * legacy key, so an upgrade does not log everyone out — they migrate to v2 on their
 * next login/refresh.
 */

const PREFIX = "v2."; // current version: HKDF-derived key
const LEGACY_PREFIX = "v1."; // pre-HKDF: legacy SHA-256(secret) key
const SESSION_INFO = "omniproject/session";
const DEV_SECRET = "omniproject-dev-secret-change-in-production";

function secret(): string {
  return process.env["SESSION_SECRET"]?.trim() || DEV_SECRET;
}
function key(): Buffer {
  return deriveKey(secret(), SESSION_INFO);
}

/** Encrypt + authenticate a string. Returns a versioned base64url token. */
export function seal(plaintext: string): string {
  return PREFIX + aesGcmSeal(plaintext, key());
}

/** Decrypt + verify. Returns null on a non-sealed value, tamper, or wrong key —
 *  never throws, so callers treat any failure as "no session". Opens both the
 *  current "v2." (HKDF) and legacy "v1." (SHA-256) envelopes. */
export function open(token: string): string | null {
  if (typeof token !== "string") return null;
  if (token.startsWith(PREFIX)) return aesGcmOpen(token.slice(PREFIX.length), key());
  if (token.startsWith(LEGACY_PREFIX)) return aesGcmOpen(token.slice(LEGACY_PREFIX.length), deriveKeyCached(secret()));
  return null;
}

export const SEALED_PREFIX = PREFIX;
