import crypto from "node:crypto";
import { deriveKey, masterSecret } from "../lib/crypto-keys";

/**
 * DETERMINISTIC component cipher for correlation identities. Encrypts ONE identity component (a project
 * GUID, a vendor, a broker, a source field) into an opaque ciphertext PIECE, so a field-identity is a
 * set of such pieces — one per component — that can be matched against a lookup and reversed.
 *
 * The encryption is DETERMINISTIC (SIV-style): the 96-bit GCM nonce is a keyed PRF (HMAC-SHA256) of the
 * (label, value), so the SAME value under the SAME component always yields the SAME ciphertext. That is
 * what makes pieces matchable — to find every field routed from a given project you encrypt the GUID
 * and compare its `project` piece against the stored ones (`matchComponent`), or resolve a piece back to
 * its value with the key (`decComponent`). It is a deliberate, standard trade-off (as with any blind
 * index / deterministic encryption): equal ciphertext reveals equal plaintext, which is exactly the
 * signal correlation needs. `label` domain-separates components (bound into both the nonce PRF and the
 * GCM AAD) so a `project` piece can never match or decrypt as a `vendor` piece, even for equal values.
 *
 * Keys derive from the shared at-rest master secret via HKDF (crypto-keys), with distinct `info` labels
 * for the encryption key and the nonce PRF key. Below the broker seam by design.
 */

const DEV_SECRET = "omniproject-dev-correlation-secret";
const secret = (): string => masterSecret({ dev: DEV_SECRET });
const encKey = (): Buffer => deriveKey(secret(), "correlation/field-cipher/enc/v1");
const nonceKey = (): Buffer => deriveKey(secret(), "correlation/field-cipher/nonce/v1");

/** The synthetic (deterministic) 96-bit nonce: a keyed PRF of the label + value. */
function syntheticNonce(label: string, value: string): Buffer {
  return crypto.createHmac("sha256", nonceKey()).update(`${label.length}:${label}${value}`).digest().subarray(0, 12);
}

/**
 * Encrypt one component into a ciphertext piece: base64url of `nonce(12) || tag(16) || ciphertext`.
 * Deterministic for a given (label, value); reversible via {@link decComponent}.
 */
export function encComponent(label: string, value: string): string {
  const nonce = syntheticNonce(label, value);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), nonce);
  cipher.setAAD(Buffer.from(label, "utf8"));
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString("base64url");
}

/** Reverse of {@link encComponent}: recover the value from a piece, or `null` if it isn't a valid piece
 *  for this `label` (wrong label, tampered, or malformed — GCM auth fails). */
export function decComponent(label: string, piece: string): string | null {
  try {
    const buf = Buffer.from(piece, "base64url");
    if (buf.length < 28) return null; // nonce(12) + tag(16) minimum
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), nonce);
    decipher.setAAD(Buffer.from(label, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Does `piece` encode `value` for this `label`? Matches by re-encrypting the candidate (deterministic)
 *  and comparing — the "match a component against a lookup" primitive. */
export function matchComponent(piece: string, label: string, value: string): boolean {
  return piece === encComponent(label, value);
}
