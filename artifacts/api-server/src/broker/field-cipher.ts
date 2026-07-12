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
 * its value with the key (`decComponent`).
 *
 * SECURITY GOAL — if the whole identity, or any single piece, leaks, an attacker WITHOUT the key can
 * infer nothing about the plaintext:
 *   · the value is hidden (AES-256-GCM),
 *   · the value's LENGTH is hidden too — every piece is padded to a FIXED size before encryption, so a
 *     leaked piece can't betray "4 chars ≈ jira" or how long a field name is, and
 *   · `label` domain-separates components (bound into both the nonce PRF and the GCM AAD), so a
 *     `project` piece can never match or decrypt as a `vendor` piece even for equal underlying values.
 * The ONLY thing a leaked piece can ever reveal is EQUALITY (two identical pieces ⇒ equal values) —
 * that's the correlation signal itself, and it's unavoidable for anything matchable.
 *
 * Keys derive from the shared at-rest master secret via HKDF (crypto-keys), with distinct `info` labels
 * for the encryption key and the nonce PRF key. Below the broker seam by design.
 */

const DEV_SECRET = "omniproject-dev-correlation-secret";
const secret = (): string => masterSecret({ dev: DEV_SECRET });
const encKey = (): Buffer => deriveKey(secret(), "correlation/field-cipher/enc/v1");
const nonceKey = (): Buffer => deriveKey(secret(), "correlation/field-cipher/nonce/v1");

// Fixed plaintext block: a 2-byte big-endian length prefix + up to CONTENT_MAX content bytes, zero-padded
// to a constant size. GCM ciphertext length equals plaintext length, so a constant block ⇒ constant piece
// length ⇒ no length side-channel.
const CONTENT_MAX = 190;
const BLOCK = 2 + CONTENT_MAX;

export class ComponentTooLongError extends Error {
  constructor(label: string, len: number) {
    super(`correlation component "${label}" is ${len} bytes; max ${CONTENT_MAX}`);
    this.name = "ComponentTooLongError";
  }
}

/** Pack `value` into the fixed-size, length-prefixed, zero-padded block. */
function pad(label: string, value: string): Buffer {
  const content = Buffer.from(value, "utf8");
  if (content.length > CONTENT_MAX) throw new ComponentTooLongError(label, content.length);
  const block = Buffer.alloc(BLOCK); // zero-filled
  block.writeUInt16BE(content.length, 0);
  content.copy(block, 2);
  return block;
}

/** Reverse of {@link pad}: read the length prefix and slice the content back out. */
function unpad(block: Buffer): string {
  const len = block.readUInt16BE(0);
  return block.subarray(2, 2 + len).toString("utf8");
}

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
  const ct = Buffer.concat([cipher.update(pad(label, value)), cipher.final()]); // fixed-size block ⇒ fixed-size ct
  return Buffer.concat([nonce, cipher.getAuthTag(), ct]).toString("base64url");
}

/** Reverse of {@link encComponent}: recover the value from a piece, or `null` if it isn't a valid piece
 *  for this `label` (wrong label, tampered, or malformed — GCM auth fails). */
export function decComponent(label: string, piece: string): string | null {
  try {
    const buf = Buffer.from(piece, "base64url");
    if (buf.length !== 12 + 16 + BLOCK) return null; // nonce(12) + tag(16) + fixed block
    const nonce = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), nonce);
    decipher.setAAD(Buffer.from(label, "utf8"));
    decipher.setAuthTag(tag);
    return unpad(Buffer.concat([decipher.update(ct), decipher.final()]));
  } catch {
    return null;
  }
}

/** Does `piece` encode `value` for this `label`? Matches by re-encrypting the candidate (deterministic)
 *  and comparing — the "match a component against a lookup" primitive. */
export function matchComponent(piece: string, label: string, value: string): boolean {
  return piece === encComponent(label, value);
}
