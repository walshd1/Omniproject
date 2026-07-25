import crypto, { type KeyObject } from "node:crypto";
import fs from "node:fs";
import { verifySignature, parsePrivateKey } from "./signing";
import { safeParseJson } from "./safe-json";
import { logger } from "./logger";

/**
 * Release provenance — the "sign + verify at boot" foundation of the update mechanism
 * (docs/UPDATE-MECHANISM.md §4, phase 1).
 *
 * A release build is signed by a private RELEASE key (held only in the release/CI trust root) over a small
 * manifest that names WHAT this build is: version, git sha, and — once known — the image content digest (the
 * promote-by-digest key, §3). The signed manifest is baked into the image. At boot the runtime verifies the
 * signature against the trusted release PUBLIC key and refuses to run a build whose provenance can't be
 * established — fail-closed. The private key never ships; the runtime only ever verifies.
 *
 * Off by default: with `RELEASE_VERIFY` unset (or "off") nothing is loaded or checked and boot is unchanged,
 * so existing deployments are unaffected. Operators opt in by baking a signed manifest + the public key and
 * setting `RELEASE_VERIFY=warn` (log only) or `RELEASE_VERIFY=strict` (refuse to boot on failure).
 */

/** What a build IS — the signed subject. `digest` is the image content digest (sha256:…), the promote-by-digest
 *  join key; absent in early builds where the digest isn't known until after the image is pushed. */
export interface ReleaseManifest {
  version: string;
  gitSha: string;
  builtAt: string;
  digest?: string;
}

/** A manifest plus its detached Ed25519 signature and the id of the key that made it. */
export interface SignedRelease {
  manifest: ReleaseManifest;
  /** base64 Ed25519 signature over {@link canonicalManifest}. */
  signature: string;
  /** Short id of the signing (release) public key — advisory; verification uses the configured trust root. */
  keyId?: string;
}

export type VerifyMode = "off" | "warn" | "strict";

/** How strictly to enforce provenance at boot. Default OFF (unchanged boot). */
export function releaseVerifyMode(env: NodeJS.ProcessEnv = process.env): VerifyMode {
  const v = (env["RELEASE_VERIFY"] ?? "").trim().toLowerCase();
  return v === "strict" || v === "warn" ? v : "off";
}

/** The trusted release verification key (SPKI PEM), from `RELEASE_PUBLIC_KEY` (PEM, or base64-DER SPKI). Null
 *  when unset. This is the root of trust — it is what a build's signature is checked against. */
export function releasePublicKeyPem(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env["RELEASE_PUBLIC_KEY"] ?? "").trim();
  if (!raw) return null;
  if (raw.includes("BEGIN")) return raw;
  try {
    // Accept a base64 SPKI DER and normalise to PEM so verifySignature's PEM path accepts it.
    const der = Buffer.from(raw, "base64");
    return crypto.createPublicKey({ key: der, format: "der", type: "spki" }).export({ format: "pem", type: "spki" }).toString();
  } catch {
    return null;
  }
}

/**
 * The canonical message a signature covers: the manifest as compact JSON with SORTED keys, so signing and
 * verification agree byte-for-byte regardless of property order. Pure.
 */
export function canonicalManifest(m: ReleaseManifest): string {
  const ordered: Record<string, unknown> = {};
  const rec = m as unknown as Record<string, unknown>;
  for (const k of Object.keys(m).sort()) {
    const v = rec[k];
    if (v !== undefined) ordered[k] = v;
  }
  return JSON.stringify(ordered);
}

/** Sign a manifest with a release PRIVATE key — the release/CI side (used by scripts/sign-release). Pure. */
export function signReleaseManifest(manifest: ReleaseManifest, privateKey: KeyObject): string {
  return crypto.sign(null, Buffer.from(canonicalManifest(manifest)), privateKey).toString("base64");
}

/** Build a {@link SignedRelease} from a manifest + a private key PEM/seed (release-side convenience). */
export function buildSignedRelease(manifest: ReleaseManifest, privateKeyRaw: string): SignedRelease | null {
  const pk = parsePrivateKey(privateKeyRaw);
  if (!pk) return null;
  const signature = signReleaseManifest(manifest, pk);
  // node26 dropped createPublicKey's KeyObject overload — derive the public half from the private key's
  // exported PKCS#8 PEM (a BinaryLike createPublicKey still accepts), mirroring lib/signing.ts.
  const pub = crypto.createPublicKey(pk.export({ format: "pem", type: "pkcs8" }));
  const keyId = crypto.createHash("sha256")
    .update(pub.export({ format: "der", type: "spki" })).digest("hex").slice(0, 16);
  return { manifest, signature, keyId };
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Parse + shape-check an untrusted signed-release object (dropping anything malformed). */
export function parseSignedRelease(value: unknown): SignedRelease | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const m = o["manifest"];
  if (!m || typeof m !== "object") return null;
  const mm = m as Record<string, unknown>;
  if (!isStr(mm["version"]) || !isStr(mm["gitSha"]) || !isStr(mm["builtAt"])) return null;
  if (!isStr(o["signature"])) return null;
  const manifest: ReleaseManifest = { version: mm["version"], gitSha: mm["gitSha"], builtAt: mm["builtAt"] };
  if (isStr(mm["digest"])) manifest.digest = mm["digest"];
  return { manifest, signature: o["signature"], ...(isStr(o["keyId"]) ? { keyId: o["keyId"] } : {}) };
}

/** Load the baked signed release: inline JSON in `RELEASE_MANIFEST`, else the file at `RELEASE_MANIFEST_FILE`
 *  (default `./release.json`). Returns null when none is present or it's malformed. */
export function loadSignedRelease(env: NodeJS.ProcessEnv = process.env): SignedRelease | null {
  const inline = (env["RELEASE_MANIFEST"] ?? "").trim();
  if (inline) { try { return parseSignedRelease(safeParseJson(inline)); } catch { return null; } }
  const file = (env["RELEASE_MANIFEST_FILE"] ?? "release.json").trim();
  try {
    if (!fs.existsSync(file)) return null;
    return parseSignedRelease(safeParseJson(fs.readFileSync(file, "utf8")));
  } catch { return null; }
}

/** Does this signed release verify against the trusted public key? Pure; never throws. */
export function verifyRelease(signed: SignedRelease, publicKeyPemStr: string): boolean {
  return verifySignature(canonicalManifest(signed.manifest), signed.signature, publicKeyPemStr);
}

/** The digest the current environment has PROMOTED (the approved production build) — from
 *  `RELEASE_EXPECTED_DIGEST`, set by the deploy/admission layer from the promotion record (§3, phase 2).
 *  Empty ⇒ no digest pin (provenance is checked; the promote-by-digest admission is skipped). */
export function expectedDigest(env: NodeJS.ProcessEnv = process.env): string | null {
  const d = (env["RELEASE_EXPECTED_DIGEST"] ?? "").trim();
  return d || null;
}

export interface ProvenanceResult {
  ok: boolean;
  mode: VerifyMode;
  reason?: string;
  manifest?: ReleaseManifest;
}

/**
 * Verify this build's provenance AND promote-by-digest admission. In "off" mode it's a no-op pass. Otherwise:
 *   1. load the signed release + trusted public key and verify the SIGNATURE (phase 1), then
 *   2. if the environment pins an approved digest (`RELEASE_EXPECTED_DIGEST`, phase 2), require the build's
 *      manifest digest to be present AND equal it — so only the exact approved build boots, never a
 *      same-tag rebuild.
 * Any failure ⇒ not ok (the caller decides warn vs refuse by mode). Pure apart from env/the baked file; never throws.
 */
export function verifyReleaseProvenance(env: NodeJS.ProcessEnv = process.env): ProvenanceResult {
  const mode = releaseVerifyMode(env);
  if (mode === "off") return { ok: true, mode };
  const signed = loadSignedRelease(env);
  if (!signed) return { ok: false, mode, reason: "no signed release manifest present" };
  const pub = releasePublicKeyPem(env);
  if (!pub) return { ok: false, mode, reason: "no RELEASE_PUBLIC_KEY configured (trust root)" };
  if (!verifyRelease(signed, pub)) {
    return { ok: false, mode, reason: "release signature does not verify against the trusted key", manifest: signed.manifest };
  }
  // Promote-by-digest admission: the running build must be the digest this environment approved.
  const expected = expectedDigest(env);
  if (expected) {
    if (!signed.manifest.digest) return { ok: false, mode, reason: "environment pins an approved digest but this build's manifest carries none", manifest: signed.manifest };
    if (signed.manifest.digest !== expected) return { ok: false, mode, reason: `running digest ${signed.manifest.digest} is not the approved digest ${expected}`, manifest: signed.manifest };
  }
  return { ok: true, mode, manifest: signed.manifest };
}

/**
 * Boot gate: verify provenance and enforce the mode. `strict` + failure ⇒ log critical and REFUSE to run
 * (fail-closed — an unattested build never serves traffic). `warn` ⇒ log a warning and continue. `off` ⇒
 * silent no-op. Returns the result (so a caller/test can inspect without exiting). The `exit` hook is
 * injectable so this stays unit-testable.
 */
export function enforceReleaseProvenanceAtBoot(
  env: NodeJS.ProcessEnv = process.env,
  exit: (code: number) => never = process.exit as (code: number) => never,
): ProvenanceResult {
  const result = verifyReleaseProvenance(env);
  if (result.mode === "off") return result;
  if (result.ok) {
    logger.info({ version: result.manifest?.version, gitSha: result.manifest?.gitSha, digest: result.manifest?.digest, mode: result.mode }, "release provenance verified");
    return result;
  }
  if (result.mode === "strict") {
    logger.error({ reason: result.reason }, "release provenance FAILED (strict) — refusing to boot an unattested build");
    exit(1);
  }
  logger.warn({ reason: result.reason }, "release provenance failed (warn) — continuing; set RELEASE_VERIFY=strict to fail closed");
  return result;
}

// ── Phase 2: the promote-by-digest RECORD + the admission check ──────────────────────────────────────────
//
// Promotion sets production to ONE digest. That decision is itself a signed artifact — a PromotionRecord
// naming the approved digest — so the deploy/admission layer can verify "this digest is the one that was
// promoted" against the same trust root, and pin the runtime to it (RELEASE_EXPECTED_DIGEST). The mutable
// tag is a human alias only; the digest is the join key (§3).

export interface PromotionRecord {
  /** The approved production image content digest (e.g. "sha256:…") — the promote-by-digest key. */
  digest: string;
  promotedAt: string;
  /** Optional free-text (e.g. "promoted from staging after org acceptance"). */
  note?: string;
}

export interface SignedPromotion {
  record: PromotionRecord;
  /** base64 Ed25519 signature over {@link canonicalPromotion}. */
  signature: string;
  keyId?: string;
}

/** Canonical signed message for a promotion — sorted-key compact JSON, like {@link canonicalManifest}. */
export function canonicalPromotion(r: PromotionRecord): string {
  const ordered: Record<string, unknown> = {};
  const rec = r as unknown as Record<string, unknown>;
  for (const k of Object.keys(r).sort()) { const v = rec[k]; if (v !== undefined) ordered[k] = v; }
  return JSON.stringify(ordered);
}

/** Sign a promotion record with the release/promotion PRIVATE key (PEM/DER/seed). Null on unparseable key. */
export function buildSignedPromotion(record: PromotionRecord, privateKeyRaw: string): SignedPromotion | null {
  const pk = parsePrivateKey(privateKeyRaw);
  if (!pk) return null;
  const signature = crypto.sign(null, Buffer.from(canonicalPromotion(record)), pk).toString("base64");
  const pub = crypto.createPublicKey(pk.export({ format: "pem", type: "pkcs8" }));
  const keyId = crypto.createHash("sha256").update(pub.export({ format: "der", type: "spki" })).digest("hex").slice(0, 16);
  return { record, signature, keyId };
}

/** Verify a signed promotion against the trusted public key. Pure; never throws. */
export function verifyPromotion(signed: SignedPromotion, publicKeyPemStr: string): boolean {
  return verifySignature(canonicalPromotion(signed.record), signed.signature, publicKeyPemStr);
}

/** Parse + shape-check an untrusted signed promotion (dropping anything malformed). */
export function parseSignedPromotion(value: unknown): SignedPromotion | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const r = o["record"];
  if (!r || typeof r !== "object") return null;
  const rr = r as Record<string, unknown>;
  if (!isStr(rr["digest"]) || !isStr(rr["promotedAt"])) return null;
  if (!isStr(o["signature"])) return null;
  const record: PromotionRecord = { digest: rr["digest"], promotedAt: rr["promotedAt"] };
  if (isStr(rr["note"])) record.note = rr["note"];
  return { record, signature: o["signature"], ...(isStr(o["keyId"]) ? { keyId: o["keyId"] } : {}) };
}

export interface AdmissionResult {
  admitted: boolean;
  reason?: string;
  digest?: string;
}

/**
 * The ADMISSION check (§3, phase 2): should this build be admitted to production? Both the build's signed
 * manifest AND the signed promotion must verify against the trusted key, and the build's digest must EQUAL
 * the promoted digest. Fail-closed — any gap denies. Pure; usable by an entrypoint / k8s admission tool that
 * has the running signed manifest, the signed promotion, and the trust root. Never throws.
 */
export function admitBuild(signedManifest: SignedRelease, signedPromotion: SignedPromotion, publicKeyPemStr: string): AdmissionResult {
  if (!verifyRelease(signedManifest, publicKeyPemStr)) return { admitted: false, reason: "build manifest signature does not verify" };
  if (!verifyPromotion(signedPromotion, publicKeyPemStr)) return { admitted: false, reason: "promotion record signature does not verify" };
  const running = signedManifest.manifest.digest;
  if (!running) return { admitted: false, reason: "build manifest carries no digest" };
  if (running !== signedPromotion.record.digest) {
    return { admitted: false, reason: `running digest ${running} is not the promoted digest ${signedPromotion.record.digest}` };
  }
  return { admitted: true, digest: running };
}
