import crypto from "node:crypto";
import { kmsConfigKey } from "./kms";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { decodeKey32, fingerprint, deriveKey, deriveKeyFromBytes, masterSecret } from "./crypto-keys";

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
const INT_PREFIX = "c1.";    // LEGACY internal (read-only): c1.<ver>.<payload> — sha256/empty-salt keys
const INT_PREFIX_V2 = "c2."; // current internal: c2.<ver>.<payload> — HKDF (shared deriveKey) keys
const BUNDLE_PREFIX = "e1."; // ephemeral bundle: e1.<payload>

/** True for either internal-format prefix (legacy c1. or current c2.). */
function isInternalToken(text: string): boolean {
  return text.startsWith(INT_PREFIX) || text.startsWith(INT_PREFIX_V2);
}

function master(): string {
  return masterSecret({ dev: "omni-config-crypto-dev-master-not-for-production" });
}

/** The raw override key, or null. Used directly for the internal format when present. A
 *  KMS-unwrapped config key (BYOK envelope, resolved at boot) takes precedence over
 *  CONFIG_KEY_RAW — so the plaintext key never sat in the environment. */
function rawKey(): Buffer | null {
  const kms = kmsConfigKey();
  if (kms) return kms;
  const raw = process.env["CONFIG_KEY_RAW"]?.trim();
  return raw ? decodeKey32(raw) : null;
}

/** Raised when a sealed (`c1.`) config token cannot be opened with the current key material
 *  (wrong / rotated / lost key, or KMS unavailable). Distinguishes "undecryptable" from "empty"
 *  so callers never silently treat unreadable ciphertext as no-content and overwrite it. */
export class ConfigDecryptError extends Error {
  constructor(message = "sealed config could not be decrypted with the current key") {
    super(message);
    this.name = "ConfigDecryptError";
  }
}

/** The internal key for a version. With a raw/KMS override, v1 uses the key directly (so files
 *  sealed before per-version salting still open), and later versions derive a distinct
 *  domain-separated subkey via HKDF — so the post-export rekey genuinely rotates the at-rest key
 *  even under CONFIG_KEY_RAW / KMS (previously a silent no-op: the same key keyed every version). */
function internalKey(version: number): Buffer {
  const raw = rawKey();
  if (raw) {
    if (version <= 1) return raw;
    return Buffer.from(crypto.hkdfSync("sha256", raw, Buffer.alloc(0), Buffer.from(`config:v${version}`), 32));
  }
  return crypto.createHash("sha256").update(`config:v${version}:${master()}`).digest();
}

/** The CURRENT (v2) internal key for a version — derived via the shared HKDF helper (deriveKey /
 *  deriveKeyFromBytes), so config-at-rest uses the same domain-separated derivation as the rest of the
 *  codebase instead of a bare SHA-256. Used for new `c2.` seals and to open them; existing `c1.`
 *  tokens keep opening via `internalKey` above, so no re-key of on-disk config is needed. */
function internalKeyV2(version: number): Buffer {
  const raw = rawKey();
  if (raw) return deriveKeyFromBytes(raw, `config:v${version}`);
  return deriveKey(master(), `config:v${version}`);
}

// Current internal key version (in-memory; advanced to the highest version ever opened so
// a rotation isn't lost across a load, and bumped on each export's rekey).
let currentVersion = 1;
function noteVersion(v: number): void { if (v > currentVersion) currentVersion = v; }

// AES-256-GCM seal/open is the shared primitive (lib/crypto-aes-gcm); this module owns only
// the versioned INT_PREFIX framing + key derivation around it.
const encrypt = aesGcmSeal;
const decrypt = aesGcmOpen;

/** Seal a config string under the current internal key (HKDF, version embedded, `c2.` format). */
export function sealConfig(plaintext: string): string {
  return `${INT_PREFIX_V2}${currentVersion}.${encrypt(plaintext, internalKeyV2(currentVersion))}`;
}

/** Open an internal-format token, or null. Handles both the current HKDF `c2.` format and legacy
 *  `c1.` tokens (so config sealed before the HKDF migration still opens). Notes the version so
 *  rotations persist. */
export function openConfig(token: string): string | null {
  const v2 = token.startsWith(INT_PREFIX_V2);
  if (!v2 && !token.startsWith(INT_PREFIX)) return null;
  const rest = token.slice((v2 ? INT_PREFIX_V2 : INT_PREFIX).length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const version = Number(rest.slice(0, dot));
  if (!Number.isInteger(version)) return null;
  noteVersion(version);
  return decrypt(rest.slice(dot + 1), v2 ? internalKeyV2(version) : internalKey(version));
}

/** Read possibly-sealed config text: open if sealed, else return as-is (plaintext migration).
 *  THROWS `ConfigDecryptError` when the text is a sealed token that fails to open — so a caller
 *  can distinguish "genuinely empty" from "can't decrypt" and refuse to overwrite valid ciphertext
 *  with default/empty state (which permanently destroyed the vault/rate-card/config stores before). */
export function readMaybeSealed(text: string): string {
  if (!isInternalToken(text)) return text;
  const opened = openConfig(text);
  if (opened === null) throw new ConfigDecryptError();
  return opened;
}

/** True iff `text` is a sealed token that CANNOT be opened with the current key material. */
export function isUndecryptableSealed(text: string): boolean {
  return isInternalToken(text) && openConfig(text) === null;
}

/** True when `text` is a sealed (internal-format) config token — a content-based check, so
 *  callers (e.g. the debug bundle) can recognise "this file IS a secret store" without knowing
 *  every filename a `SealedFile`-backed module happens to use. */
export function isSealedConfig(text: string): boolean {
  return isInternalToken(text);
}

/** Rotate the internal key forward (new seals use the next version). */
export function rotateInternalKey(): number {
  currentVersion += 1;
  return currentVersion;
}

/** A non-secret fingerprint of the CURRENT internal key (confirm a match without revealing). */
export function internalKeyFingerprint(): string {
  return fingerprint(internalKeyV2(currentVersion));
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
