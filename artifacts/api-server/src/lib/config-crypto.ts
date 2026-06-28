import crypto from "node:crypto";
import { kmsConfigKey } from "./kms";

/**
 * Config-at-rest encryption + secure export.
 *
 * Config files are sealed on disk with AES-256-GCM under an INTERNAL key. That internal
 * key is NEVER exported. To move config to another deployment the export instead:
 *   1. DECRYPTS the live config with the current internal key;
 *   2. mints a one-time EPHEMERAL key and RE-ENCRYPTS the bundle under it;
 *   3. returns the encrypted bundle + the ephemeral key (the only secret that leaves —
 *      and it only ever decrypts that one bundle);
 *   4. then REKEYS internal use — rotates the internal key and re-seals the on-disk file,
 *      so the live store is under fresh material the export never saw.
 *
 * The internal key is VERSIONED and the version is embedded (non-secret) in each token, so
 * a rotation survives restarts: a token names the version it needs, derived from the env
 * master. CONFIG_KEY_RAW (base64 32 bytes), if set, is used directly (version ignored) —
 * the manual override for restoring a specific key.
 *
 * HONEST SCOPE: protects data AT REST; not against someone holding the master/process. The
 * ephemeral key is a real secret leaving the boundary, so export is admin + step-up gated.
 */
const INT_PREFIX = "c1.";   // internal, versioned: c1.<ver>.<payload>
const BUNDLE_PREFIX = "e1."; // ephemeral bundle: e1.<payload>

function master(): string {
  return (
    process.env["SESSION_SECRET"]?.trim() ||
    process.env["BROKER_PSK"]?.trim() ||
    "omni-config-crypto-dev-master-not-for-production"
  );
}

/** The raw override key, or null. Used directly for the internal format when present. A
 *  KMS-unwrapped config key (BYOK envelope, resolved at boot) takes precedence over
 *  CONFIG_KEY_RAW — so the plaintext key never sat in the environment. */
function rawKey(): Buffer | null {
  const kms = kmsConfigKey();
  if (kms) return kms;
  const raw = process.env["CONFIG_KEY_RAW"]?.trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : null;
}

/** The internal key for a version (raw override wins; else derived, domain-separated). */
function internalKey(version: number): Buffer {
  return rawKey() ?? crypto.createHash("sha256").update(`config:v${version}:${master()}`).digest();
}

// Current internal key version (in-memory; advanced to the highest version ever opened so
// a rotation isn't lost across a load, and bumped on each export's rekey).
let currentVersion = 1;
function noteVersion(v: number): void { if (v > currentVersion) currentVersion = v; }

function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64url");
}

function decrypt(payload: string, key: Buffer): string | null {
  try {
    const raw = Buffer.from(payload, "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Seal a config string under the current internal key (version embedded). */
export function sealConfig(plaintext: string): string {
  return `${INT_PREFIX}${currentVersion}.${encrypt(plaintext, internalKey(currentVersion))}`;
}

/** Open an internal-format token, or null. Notes the token's version so rotations persist. */
export function openConfig(token: string): string | null {
  if (!token.startsWith(INT_PREFIX)) return null;
  const rest = token.slice(INT_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const version = Number(rest.slice(0, dot));
  if (!Number.isInteger(version)) return null;
  noteVersion(version);
  return decrypt(rest.slice(dot + 1), internalKey(version));
}

/** Read possibly-sealed config text: open if sealed, else return as-is (plaintext migration). */
export function readMaybeSealed(text: string): string {
  return text.startsWith(INT_PREFIX) ? (openConfig(text) ?? "") : text;
}

/** Rotate the internal key forward (new seals use the next version). */
export function rotateInternalKey(): number {
  currentVersion += 1;
  return currentVersion;
}

/** A non-secret fingerprint of the CURRENT internal key (confirm a match without revealing). */
export function internalKeyFingerprint(): string {
  return crypto.createHash("sha256").update(internalKey(currentVersion)).digest("hex").slice(0, 12);
}

export interface ExportedBundle {
  /** The config, re-encrypted under a one-time ephemeral key (move this file). */
  bundle: string;
  /** The ephemeral key (base64) — the only secret that leaves; decrypts just this bundle. */
  exportKey: string;
  /** The internal key version before/after the post-export rekey. */
  fromVersion: number;
  toVersion: number;
}

/**
 * Produce a portable, ephemerally-keyed bundle of `plaintext`, then ROTATE the internal
 * key. The caller re-seals the live store afterwards (so it lands under the new version).
 */
export function exportConfigBundle(plaintext: string): ExportedBundle {
  const ephemeral = crypto.randomBytes(32);
  const bundle = `${BUNDLE_PREFIX}${encrypt(plaintext, ephemeral)}`;
  const fromVersion = currentVersion;
  const toVersion = rotateInternalKey();
  return { bundle, exportKey: ephemeral.toString("base64"), fromVersion, toVersion };
}

/** Open an exported bundle with its ephemeral key (the import side, on another deployment). */
export function openBundle(bundle: string, exportKey: string): string | null {
  if (!bundle.startsWith(BUNDLE_PREFIX)) return null;
  const key = Buffer.from(exportKey, "base64");
  if (key.length !== 32) return null;
  return decrypt(bundle.slice(BUNDLE_PREFIX.length), key);
}

/** Test-only: reset the internal key version. */
export function __resetConfigCrypto(): void { currentVersion = 1; }
