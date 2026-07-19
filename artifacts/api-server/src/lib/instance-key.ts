import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deriveKey, masterSecret, fingerprint, decodeKey32 } from "./crypto-keys";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { resolveConfigFile } from "./sealed-file";
import { safeParseJson } from "./safe-json";
import { logger } from "./logger";

/**
 * INSTANCE RECOVERY KEY (IRK) — the portable secret an operator SAVES on first setup and needs to open an
 * encrypted backup on a fresh box. It is a random 32-byte AES key that seals the portable backup
 * (lib/instance-backup), decoupled from the deployment's config key so a backup travels to any instance.
 *
 * AT REST it is never plaintext and never a bare env var (the operator's stated requirement): the raw key is
 * WRAPPED under a master-derived key (`deriveKey(master, "instance-key:v1")`) and stored as an AES-256-GCM
 * token, so a disk read alone doesn't yield a copy-pasteable key — you also need the master (SESSION_SECRET /
 * KMS-unwrapped material). When a KMS is configured the master itself chains to the HSM, so the wrap inherits
 * that protection. (A dedicated KMS wrap of the IRK is a natural follow-up.)
 *
 * REVEAL-ONCE: the raw key is shown to the admin exactly once (first setup, or after a rotation); a
 * `revealed` flag makes the export button one-time. Lost it before saving? Rotate to mint + reveal a new one
 * (which invalidates the old — future backups use the new key).
 */

const WRAP_INFO = "instance-key:v1";

interface StoredKey {
  /** The IRK, wrapped (AES-256-GCM token) under the master-derived wrap key. */
  wrapped: string;
  /** Whether the raw key has been revealed to an admin (one-time export gate). */
  revealed: boolean;
  createdAt: string;
}

function wrapKey(): Buffer {
  return deriveKey(masterSecret({ dev: "omni-instance-key-dev-master-not-for-production" }), WRAP_INFO);
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
  const fd = fs.openSync(tmp, "w");
  try { fs.writeSync(fd, JSON.stringify(stored)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
  cache = stored; loaded = true;
}

function newWrappedKey(now: string, revealed = false): { stored: StoredKey; raw: Buffer } {
  const raw = crypto.randomBytes(32);
  return { stored: { wrapped: aesGcmSeal(raw.toString("base64"), wrapKey()), revealed, createdAt: now }, raw };
}

/** Unwrap the stored IRK to raw bytes, or null (absent / unreadable / wrong master). */
export function getInstanceKey(): Buffer | null {
  const s = load();
  if (!s) return null;
  const b64 = aesGcmOpen(s.wrapped, wrapKey());
  return b64 ? decodeKey32(b64) : null;
}

/** Ensure an IRK exists, minting + wrapping + persisting one if absent. Returns the raw key (or null when the
 *  store is disabled). Idempotent — an existing key is never regenerated. */
export function ensureInstanceKey(now: string): Buffer | null {
  if (!instanceKeyEnabled()) return null;
  const existing = getInstanceKey();
  if (existing) return existing;
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
