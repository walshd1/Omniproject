import crypto from "node:crypto";
import { signMessage, verifySignature, publicKeyId, publicKeyPem } from "./signing";

/**
 * Provably-immutable snapshots. A snapshot freezes a set of inputs (a report's rows, a board pack) so it
 * can be reproduced and shown to be UNALTERED later — without OmniProject becoming a system of record.
 *
 * How "provable" works:
 *  - the content is canonicalised (stable key order) and SHA-256 hashed → tamper-evident, and
 *  - the manifest anchor (id + scope + time + hash) is signed with the deployment's Ed25519 key → anyone
 *    holding the published public key can verify it offline (non-repudiation), no server round-trip needed.
 * The full data bundle is handed back for the holder to KEEP (zero-at-rest preserved); only the tiny
 * manifest needs to travel for verification. Pure given (id, createdAt) — those are injected by the route.
 */

export interface SnapshotManifest {
  id: string;
  /** What was snapshotted (e.g. "portfolio-financials" or "project:proj-001"). */
  scope: string;
  label: string;
  /** Server-set capture time (ISO 8601). */
  createdAt: string;
  rowCount: number;
  /** SHA-256 hex of the canonicalised content. */
  contentHash: string;
  hashAlgorithm: "sha256";
  /** Non-repudiation layer, present only when Ed25519 signing is configured. */
  signatureAlgorithm?: "Ed25519";
  signature?: string;
  publicKeyId?: string;
}

/** A complete snapshot the holder keeps: the manifest + the exact data it attests to. */
export interface SnapshotBundle {
  manifest: SnapshotManifest;
  data: unknown;
}

/** Deterministic JSON with sorted object keys, so the hash is stable regardless of property order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** SHA-256 hex of the canonicalised value — the content address. */
export function contentHash(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** The exact, deterministic message that is signed for a manifest — binds the content hash to its
 *  identity + time + scope, so altering any of them invalidates the signature. */
export function manifestAnchor(m: Pick<SnapshotManifest, "id" | "scope" | "createdAt" | "rowCount" | "contentHash" | "hashAlgorithm">): string {
  return canonicalJson({ id: m.id, scope: m.scope, createdAt: m.createdAt, rowCount: m.rowCount, contentHash: m.contentHash, hashAlgorithm: m.hashAlgorithm });
}

/** Build a signed snapshot bundle over `data`. The signature layer is added only when signing is on. */
export function buildSnapshot(input: { id: string; scope: string; label: string; createdAt: string; data: unknown }): SnapshotBundle {
  const rowCount = Array.isArray(input.data) ? input.data.length : 1;
  const hash = contentHash(input.data);
  const manifest: SnapshotManifest = {
    id: input.id,
    scope: input.scope,
    label: input.label,
    createdAt: input.createdAt,
    rowCount,
    contentHash: hash,
    hashAlgorithm: "sha256",
  };
  const sig = signMessage(manifestAnchor(manifest));
  if (sig) {
    manifest.signatureAlgorithm = "Ed25519";
    manifest.signature = sig;
    const kid = publicKeyId();
    if (kid) manifest.publicKeyId = kid;
  }
  return { manifest, data: input.data };
}

export interface SnapshotVerdict {
  ok: boolean;
  /** Does the data still hash to the manifest's contentHash? */
  contentMatches: boolean;
  /** Ed25519 signature valid? `null` when the manifest carries no signature (integrity-only proof). */
  signatureValid: boolean | null;
  reason: string;
}

/**
 * Verify a bundle: recompute the content hash and (if present) check the Ed25519 signature against the
 * supplied public key (defaults to this deployment's). `ok` requires the content to match AND — when a
 * signature is present — the signature to be valid.
 */
export function verifySnapshot(bundle: SnapshotBundle, pubKeyPem: string | null = publicKeyPem()): SnapshotVerdict {
  const m = bundle.manifest;
  const recomputed = contentHash(bundle.data);
  const contentMatches = recomputed === m.contentHash;
  if (!contentMatches) {
    return { ok: false, contentMatches: false, signatureValid: m.signature ? false : null, reason: "content has been altered (hash mismatch)" };
  }
  if (!m.signature) {
    return { ok: true, contentMatches: true, signatureValid: null, reason: "content intact (unsigned — integrity only, no non-repudiation)" };
  }
  if (!pubKeyPem) {
    return { ok: false, contentMatches: true, signatureValid: false, reason: "signed snapshot but no public key available to verify it" };
  }
  const signatureValid = verifySignature(manifestAnchor(m), m.signature, pubKeyPem);
  return signatureValid
    ? { ok: true, contentMatches: true, signatureValid: true, reason: "authentic and unaltered (content hash + Ed25519 signature verified)" }
    : { ok: false, contentMatches: true, signatureValid: false, reason: "signature does not verify (manifest tampered or wrong key)" };
}
