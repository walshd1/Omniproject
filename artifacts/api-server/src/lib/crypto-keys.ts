import crypto from "node:crypto";

/**
 * Small shared key/hash primitives, so the same derivations aren't hand-rolled in every
 * crypto module. None of these are domain policy — each domain still owns its secret source,
 * prefix and envelope (see crypto-aes-gcm); these just remove duplicated boilerplate.
 */

// sha256(secret) → 32-byte key, memoised by secret so repeated calls don't re-hash. There are
// only a handful of distinct secrets in a process (session, broker PSK), so the map stays tiny.
const keyCache = new Map<string, Buffer>();

/** Derive a 32-byte AES key from a high-entropy secret via SHA-256, cached by secret. */
export function deriveKeyCached(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.createHash("sha256").update(secret).digest();
    keyCache.set(secret, key);
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
