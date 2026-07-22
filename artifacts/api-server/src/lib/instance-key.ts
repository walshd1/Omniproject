import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deriveKey, deriveKeyFromBytes, masterSecret, fingerprint, decodeKey32 } from "./crypto-keys";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { kmsConfigKey } from "./kms";
import { resolveConfigFile } from "./sealed-file";
import { safeParseJson } from "./safe-json";
import { logger } from "./logger";

/**
 * INSTANCE RECOVERY KEY (IRK) — the portable secret an operator SAVES on first setup and needs to open an
 * encrypted backup on a fresh box. It is a random 32-byte AES key that seals the portable backup
 * (lib/instance-backup), decoupled from the deployment's config key so a backup travels to any instance.
 *
 * AT REST it is never plaintext and never a bare env var (the operator's stated requirement): the raw key is
 * WRAPPED under a wrap key and stored as an AES-256-GCM token, so a disk read alone doesn't yield a
 * copy-pasteable key. The wrap key is chosen thus:
 *   - KMS-NATIVE (preferred): when a cloud KMS is configured, the IRK is wrapped directly under the
 *     KMS-unwrapped config ROOT key (`deriveKeyFromBytes(kmsConfigKey(), "instance-key:v1")`), the same
 *     HSM-rooted material that seals config at rest. The IRK's protection then sits fully in the HSM rather
 *     than deriving from the process master — parity with how the config/vault roots are protected.
 *   - MASTER-DERIVED (fallback): with no KMS, the wrap key derives from the master secret
 *     (`deriveKey(master, "instance-key:v1")`) — SESSION_SECRET / BROKER_PSK / dev.
 * UNWRAP tries BOTH (KMS first, then master), so an IRK minted before KMS was enabled keeps opening after
 * you turn KMS on; boot then re-wraps it under the KMS root IN PLACE — the key VALUE is unchanged (existing
 * backups still open), only its at-rest wrap moves into the HSM. (Conversely, once wrapped under the KMS
 * root, losing the KMS loses the wrap — that's the point of rooting it in the HSM.)
 *
 * REVEAL-ONCE: the raw key is shown to the admin exactly once (first setup, or after a rotation); a
 * `revealed` flag makes the export button one-time. Lost it before saving? Rotate to mint + reveal a new one
 * (which invalidates the old — future backups use the new key).
 */

const WRAP_INFO = "instance-key:v1";

interface StoredKey {
  /** The IRK, wrapped (AES-256-GCM token) under the KMS-native or master-derived wrap key. */
  wrapped: string;
  /** Whether the raw key has been revealed to an admin (one-time export gate). */
  revealed: boolean;
  createdAt: string;
}

/** The master-derived wrap key (the no-KMS fallback). */
function masterWrapKey(): Buffer {
  return deriveKey(masterSecret({ dev: "omni-instance-key-dev-master-not-for-production" }), WRAP_INFO);
}

/** The KMS-native wrap key: the IRK wrapped directly under the KMS-unwrapped config ROOT, domain-separated
 *  via HKDF so it never reuses the config-at-rest subkey. null when no KMS root has resolved. */
function kmsWrapKey(): Buffer | null {
  const kms = kmsConfigKey();
  return kms ? deriveKeyFromBytes(kms, WRAP_INFO) : null;
}

/** The wrap key used to SEAL a new/rotated IRK — KMS-native when available, else master-derived. */
function wrapKey(): Buffer {
  return kmsWrapKey() ?? masterWrapKey();
}

/** Candidate wrap keys to try when UNWRAPPING, most-preferred first. Trying the KMS-native key then the
 *  master-derived one lets an IRK minted before KMS was enabled keep opening (and get re-wrapped under the
 *  KMS root on the next rotate). aesGcmOpen returns null on the wrong key, so a mismatch just falls through. */
function unwrapCandidates(): Buffer[] {
  const kms = kmsWrapKey();
  return kms ? [kms, masterWrapKey()] : [masterWrapKey()];
}

function keyFile(): string | null {
  return resolveConfigFile("INSTANCE_KEY_FILE", "instance-key.sealed");
}

/** Whether the instance-key store can persist (a path resolves). */
export function instanceKeyEnabled(): boolean {
  return keyFile() !== null;
}

let cache: StoredKey | null = null;
let loaded = false;

/** Test-only: drop the in-memory cache so an env/path change is re-read. */
export function _resetInstanceKeyCache(): void { cache = null; loaded = false; }

function load(): StoredKey | null {
  if (loaded) return cache;
  const f = keyFile();
  cache = null;
  if (f && fs.existsSync(f)) {
    try {
      // safeParseJson (prototype-pollution safe): the OUTER wrapper isn't GCM-authenticated (only the `wrapped`
      // field inside is), so a tampered file must not be able to plant a __proto__/constructor key on parse.
      const parsed = safeParseJson<unknown>(fs.readFileSync(f, "utf8"));
      if (parsed && typeof parsed === "object" && typeof (parsed as StoredKey).wrapped === "string") {
        cache = { wrapped: (parsed as StoredKey).wrapped, revealed: (parsed as StoredKey).revealed === true, createdAt: (parsed as StoredKey).createdAt ?? "" };
      }
    } catch (err) { logger.error({ err }, "instance-key: failed to read/parse the key file"); }
  }
  loaded = true;
  return cache;
}

function persist(stored: StoredKey): void {
  const f = keyFile();
  if (!f) throw new Error("instance-key store is not configured (set OMNI_CONFIG_DIR or INSTANCE_KEY_FILE)");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600); // 0o600: wraps the instance root key — never world-readable
  try { fs.writeSync(fd, JSON.stringify(stored)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
  cache = stored; loaded = true;
}

function newWrappedKey(now: string, revealed = false): { stored: StoredKey; raw: Buffer } {
  const raw = crypto.randomBytes(32);
  return { stored: { wrapped: aesGcmSeal(raw.toString("base64"), wrapKey()), revealed, createdAt: now }, raw };
}

/** Unwrap the stored IRK to raw bytes, or null (absent / unreadable / no matching wrap key). Tries the
 *  KMS-native wrap key first, then the master-derived one, so an IRK survives enabling KMS on an instance
 *  that first minted it under the master. */
export function getInstanceKey(): Buffer | null {
  const s = load();
  if (!s) return null;
  for (const key of unwrapCandidates()) {
    const b64 = aesGcmOpen(s.wrapped, key);
    if (b64) return decodeKey32(b64);
  }
  return null;
}

/** If the stored IRK opens but NOT under the currently-preferred wrap key (e.g. KMS was enabled after the key
 *  was first minted under the master), re-seal it under the preferred key WITHOUT changing the key value —
 *  existing backups still open, but the at-rest wrap now chains to the HSM. No-op when already preferred /
 *  absent / unreadable. Preserves the revealed gate + createdAt. */
function rewrapUnderPreferredKey(): void {
  const s = load();
  if (!s) return;
  const preferred = wrapKey();
  if (aesGcmOpen(s.wrapped, preferred)) return; // already wrapped under the preferred key
  for (const key of unwrapCandidates()) {
    const b64 = aesGcmOpen(s.wrapped, key);
    if (b64) {
      persist({ ...s, wrapped: aesGcmSeal(b64, preferred) });
      logger.info("instance-key: re-wrapped IRK under the preferred (KMS-native) wrap key");
      return;
    }
  }
}

/** Ensure an IRK exists, minting + wrapping + persisting one if absent. Returns the raw key (or null when the
 *  store is disabled). Idempotent — an existing key is never regenerated, but its wrap is upgraded to the
 *  KMS-native key in place if KMS became available since it was minted. */
export function ensureInstanceKey(now: string): Buffer | null {
  if (!instanceKeyEnabled()) return null;
  const existing = getInstanceKey();
  if (existing) { rewrapUnderPreferredKey(); return existing; }
  const { stored, raw } = newWrappedKey(now);
  persist(stored);
  return raw;
}

/** Rotate to a fresh IRK (mint + wrap + persist), resetting the reveal gate. Returns the new raw key. Future
 *  backups seal under it; the old key still opens old backups but is no longer this instance's key. */
export function rotateInstanceKey(now: string): Buffer {
  if (!instanceKeyEnabled()) throw new Error("instance-key store is not configured");
  const { stored, raw } = newWrappedKey(now);
  persist(stored);
  return raw;
}

/** Whether the current IRK has been revealed to an admin (the one-time export gate). */
export function isInstanceKeyRevealed(): boolean {
  return load()?.revealed === true;
}

/** Mark the current IRK revealed (called after a successful one-time reveal). No-op when absent. */
export function markInstanceKeyRevealed(): void {
  const s = load();
  if (s && !s.revealed) persist({ ...s, revealed: true });
}

/** A non-secret fingerprint of the current IRK — confirm which key a backup needs without revealing it. */
export function instanceKeyFingerprint(): string | null {
  const raw = getInstanceKey();
  return raw ? fingerprint(raw) : null;
}
