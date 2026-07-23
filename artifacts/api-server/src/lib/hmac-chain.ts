import { createHmac, type BinaryLike } from "node:crypto";
import { constantTimeEqual } from "./crypto-keys";
import { signMessage, publicKeyId, verifySignature } from "./signing";

/**
 * Shared primitives for the deployment's keyed, hash-chained tamper-evidence logs — the audit chain
 * (lib/audit-chain), the provenance ring (lib/provenance) and OmniStore's event log
 * (broker/builtin/omnistore-log). Those three independently grew the same two shapes; this module is
 * the single home for the parts that are genuinely identical, so they can't drift apart:
 *
 *  1. The LINK HASH — `HMAC(chainKey, seq | prevHash | canonicalBody)`. The audit chain and the
 *     OmniStore log use this byte-for-byte identical formula; extracting it guarantees the two on-disk
 *     wire formats stay in lockstep. `verifyChainLink` recomputes it and compares CONSTANT-TIME, so a
 *     holder of a tampered at-rest copy can't use a byte-by-byte timing oracle to forge a valid link
 *     without the chain key. (Provenance's per-entry MAC binds a bespoke field set — timeline, session,
 *     key version — so it is NOT this formula and stays in its own module.)
 *
 *  2. The ANCHOR SIGNATURE — wrapping a chain TIP with an optional Ed25519 signature (non-repudiation)
 *     when asymmetric signing is configured. The audit and provenance anchors did this identically; the
 *     per-chain part (which tip fields go into the signed message) stays with each caller as its own
 *     `*AnchorMessage`, so the exact signed bytes are unchanged — only the sign/attach + verify
 *     boilerplate is shared here.
 */

// ── 1. Keyed hash-chain link ────────────────────────────────────────────────────

/** The keyed link hash binding an event to its sequence position and its predecessor: the exact,
 *  reproducible `HMAC(chainKey, "seq|prevHash|canonicalBody")` the chained logs commit each link with. */
export function chainLinkHash(chainKey: BinaryLike, seq: number, prevHash: string, canonicalBody: string): string {
  return createHmac("sha256", chainKey).update(`${seq}|${prevHash}|${canonicalBody}`).digest("hex");
}

/** Recompute a link's hash and compare it CONSTANT-TIME to the claimed value — the tamper check every
 *  chain `verify()` runs. Constant-time because `claimedHash` is attacker-controllable at rest and a
 *  short-circuiting `===` would leak how much of a forged hash is correct. */
export function verifyChainLink(chainKey: BinaryLike, seq: number, prevHash: string, canonicalBody: string, claimedHash: string): boolean {
  return constantTimeEqual(chainLinkHash(chainKey, seq, prevHash, canonicalBody), claimedHash);
}

// ── 2. Ed25519 anchor signature (optional non-repudiation layer) ─────────────────

/** The optional asymmetric-signature fields an anchor carries when Ed25519 signing is configured. */
export interface AnchorSignature {
  signatureAlgorithm: "Ed25519";
  publicKeyId?: string;
  signature: string;
}

/** Attach an Ed25519 signature over `message` to a chain-tip anchor `base`, when signing is configured
 *  (else return `base` unsigned). `message` is the caller's own deterministic tip encoding, so the exact
 *  signed bytes stay owned by — and stable within — each chain. */
export function attachAnchorSignature<T extends object>(base: T, message: string): T & Partial<AnchorSignature> {
  const signature = signMessage(message);
  if (!signature) return base;
  const kid = publicKeyId();
  return { ...base, signatureAlgorithm: "Ed25519", signature, ...(kid ? { publicKeyId: kid } : {}) };
}

/** Verify an anchor's Ed25519 signature over the caller's rebuilt tip `message`. False when the anchor
 *  is unsigned or the signature doesn't match — pure, for an offline auditor. */
export function verifyAnchorSignature(signature: string | undefined, message: string, publicKeyPemStr: string): boolean {
  return signature ? verifySignature(message, signature, publicKeyPemStr) : false;
}
