import crypto from "node:crypto";

/**
 * Small shared key/hash primitives, so the same derivations aren't hand-rolled in every
 * crypto module. None of these are domain policy — each domain still owns its secret source,
 * prefix and envelope (see crypto-aes-gcm); these just remove duplicated boilerplate.
 */

// Derived keys are memoised so repeated calls don't re-run the KDF. There are only a handful of
// distinct (secret, domain) pairs in a process (session, broker PSK), so the map stays tiny.
const keyCache = new Map<string, Buffer>();

// A fixed, application-wide HKDF salt. HKDF's security does not require a secret salt; a constant
// salt is fine here (the input keying material is already a high-entropy secret) and keeping it
// fixed makes derivation reproducible across restarts and across the gateway↔broker pair. Domain
// separation between key uses comes from the per-call `info` label, not the salt.
const HKDF_SALT = Buffer.from("omniproject/hkdf/v1");

/**
 * Derive a 32-byte AES key from a high-entropy secret via HKDF-SHA256, with a domain-separation
 * `info` label so the same secret yields independent keys per use. Cached by (secret, info).
 *
 * Preferred over the legacy `deriveKeyCached` (plain SHA-256): HKDF is a purpose-built KDF and the
 * `info` binding means a key minted for one domain can never collide with another's.
 */
export function deriveKey(secret: string, info: string): Buffer {
  // Length-prefix `info` so the (info, secret) boundary is unambiguous: a space-joined key would
  // let deriveKey("z","x y") and deriveKey("y z","x") collide, silently breaking domain separation.
  const cacheKey = `${info.length}:${info}${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    // hkdfSync returns an ArrayBuffer; wrap it as a Buffer for the crypto APIs.
    key = Buffer.from(crypto.hkdfSync("sha256", secret, HKDF_SALT, info, 32));
    keyCache.set(cacheKey, key);
  }
  return key;
}

// Legacy sha256(secret) cache (distinct keyspace from deriveKey's).
const legacyCache = new Map<string, Buffer>();

/**
 * LEGACY derivation: sha256(secret) → 32-byte key, cached by secret. Retained ONLY so envelopes
 * sealed before the HKDF migration (session "v1.", broker "p1.") can still be opened. New code
 * should use `deriveKey(secret, info)`.
 */
export function deriveKeyCached(secret: string): Buffer {
  let key = legacyCache.get(secret);
  if (!key) {
    key = crypto.createHash("sha256").update(secret).digest();
    legacyCache.set(secret, key);
  }
  return key;
}

/** Parse a base64 key that must be exactly 32 bytes (an AES-256 key), or null if it isn't. */
export function decodeKey32(b64: string): Buffer | null {
  const buf = Buffer.from(b64, "base64");
  return buf.length === 32 ? buf : null;
}

/** A short hex fingerprint of a value (SHA-256, truncated). For correlation/key ids and
 *  presence checks — NOT a security primitive (it's truncated and unkeyed). */
export function fingerprint(value: crypto.BinaryLike, len = 12): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, len);
}

/**
 * Constant-time string equality: length-checked first (a length mismatch is not
 * secret-dependent, so short-circuiting on it leaks nothing), then `crypto.timingSafeEqual`
 * over equal-length buffers so a MATCHING prefix can't be timed out of a comparison against a
 * secret (tokens, HMACs, CSRF doubles-submit values, SCIM bearer). The one shared home for
 * this comparison — every caller (api-token, csrf, broker-hmac, scim, provenance) used to
 * hand-roll the same three lines.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
