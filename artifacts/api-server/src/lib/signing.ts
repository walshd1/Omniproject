import crypto, { type KeyObject } from "node:crypto";
import { logger } from "./logger";

/**
 * Optional asymmetric (Ed25519) signing — the non-repudiation layer over the audit chain
 * and the provenance chain.
 *
 * The keyed-MAC chains (lib/audit-chain, lib/provenance) are tamper-EVIDENT: a holder of the
 * shared key can detect alteration, but — because the same key signs AND verifies — they
 * can't prove the GATEWAY (rather than any key-holder) produced the record. Signing the
 * chain's anchor (its hash-linked tip) with a private key the gateway alone holds closes
 * that gap: anyone with the PUBLIC key can confirm the gateway attests to that tip, and the
 * hash links extend that attestation over the whole history. That is non-repudiation.
 *
 * Opt-in and side-effect-free by default: with `SIGNING_PRIVATE_KEY` unset, signing is OFF
 * and anchors carry no signature (exactly today's behaviour). The operator supplies an
 * Ed25519 PRIVATE key as PEM (PKCS#8), base64 PKCS#8 DER, or a base64 32-byte raw seed; the
 * gateway derives and publishes the matching public key.
 */

// The fixed PKCS#8 prefix for an Ed25519 private key, so a bare 32-byte seed can be wrapped
// into a DER the runtime accepts (SEQ · version · AlgId{1.3.101.112} · OCTET STRING · seed).
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Parse an Ed25519 private key from PEM, base64 PKCS#8 DER, or a base64 32-byte seed.
 *  Returns null (and logs) on anything unparseable — signing then stays disabled. */
export function parsePrivateKey(raw: string): KeyObject | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    if (text.includes("BEGIN")) return crypto.createPrivateKey({ key: text, format: "pem" });
    const buf = Buffer.from(text, "base64");
    if (buf.length === 32) {
      return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, buf]), format: "der", type: "pkcs8" });
    }
    return crypto.createPrivateKey({ key: buf, format: "der", type: "pkcs8" });
  } catch (err) {
    logger.error({ err }, "signing: SIGNING_PRIVATE_KEY could not be parsed — non-repudiation signing DISABLED");
    return null;
  }
}

const privateKey = parsePrivateKey(process.env["SIGNING_PRIVATE_KEY"] ?? "");
const publicKey = privateKey ? crypto.createPublicKey(privateKey) : null;

/** Whether non-repudiation signing is configured (a private key was loaded). */
export function signingEnabled(): boolean {
  return privateKey !== null;
}

/** The gateway's published verification key (SPKI PEM), or null when signing is off. */
export function publicKeyPem(): string | null {
  return publicKey ? publicKey.export({ format: "pem", type: "spki" }).toString() : null;
}

/** A short, stable id for the public key (first 16 hex of SHA-256 over its SPKI DER) so a
 *  signature can name the key it was made with. Null when signing is off. */
export function publicKeyId(): string | null {
  return publicKey
    ? crypto.createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex").slice(0, 16)
    : null;
}

/** Sign a message with the gateway private key (base64), or null when signing is off. */
export function signMessage(message: string): string | null {
  return privateKey ? crypto.sign(null, Buffer.from(message), privateKey).toString("base64") : null;
}

/** Verify a base64 Ed25519 signature over `message` against an SPKI/PEM public key. Pure —
 *  an offline auditor passes the gateway's published key; never throws (bad input ⇒ false). */
export function verifySignature(message: string, signatureB64: string, publicKeyPemStr: string): boolean {
  try {
    const pk = crypto.createPublicKey({ key: publicKeyPemStr, format: "pem" });
    return crypto.verify(null, Buffer.from(message), pk, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export interface SigningInfo {
  enabled: boolean;
  algorithm: "Ed25519";
  publicKeyId: string | null;
  publicKeyPem: string | null;
}

/** Public signing status for the admin/security surface (no secrets — public key only). */
export function signingInfo(): SigningInfo {
  return { enabled: signingEnabled(), algorithm: "Ed25519", publicKeyId: publicKeyId(), publicKeyPem: publicKeyPem() };
}
