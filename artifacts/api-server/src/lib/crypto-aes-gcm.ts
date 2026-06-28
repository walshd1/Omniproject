import crypto from "node:crypto";

/**
 * The one AES-256-GCM seal/open primitive.
 *
 * Several domains encrypt a short string at rest or in transit — the config store, the
 * session cookie, the gateway↔broker payload, the per-secret vault envelope. They all used
 * the SAME wire format (`base64url(iv[12] ‖ tag[16] ‖ ciphertext)`) but each hand-rolled the
 * `createCipheriv`/IV/tag/`base64url` dance, so a fix to one (IV length, tag handling, a
 * timing-safe tweak) could silently miss the others. This is the single implementation.
 *
 * It is DELIBERATELY un-prefixed and un-versioned: each domain keeps its OWN prefix and key
 * derivation (that's the part that must stay separate — different secrets, different threat
 * models). The format here is unchanged from the previous copies, so already-sealed data
 * (config files, vault secrets, live cookies) opens exactly as before.
 */

const IV_LEN = 12; // GCM standard 96-bit nonce
const TAG_LEN = 16; // GCM 128-bit auth tag

/** Encrypt + authenticate `plaintext` with a 32-byte key → `base64url(iv ‖ tag ‖ ct)`.
 *  Callers prepend their own domain/version prefix. */
export function aesGcmSeal(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

/** Inverse of `aesGcmSeal` (pass the body WITHOUT any domain prefix). Returns null on a
 *  malformed token, tamper, or wrong key — never throws, so callers treat any failure as
 *  "no/invalid value". */
export function aesGcmOpen(body: string, key: Buffer): string | null {
  try {
    const raw = Buffer.from(body, "base64url");
    if (raw.length < IV_LEN + TAG_LEN) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, IV_LEN));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    return Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
