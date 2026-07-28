import { scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deriveKey, masterSecret, constantTimeEqualBuf } from "./crypto-keys";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { resolveConfigFile } from "./sealed-file";
import { logger } from "./logger";
import { safeParseJson } from "./safe-json";
import { normalizeRecoveryCode } from "./totp";

/**
 * PER-USER TOTP 2FA STORE — the enrolled authenticator secret + recovery-code hashes, in a SEPARATELY-KEYED
 * sealed store, isolated from the config store, the AI vault, and the password store. Mirrors
 * `lib/user-credentials.ts` exactly: sealed under its OWN key domain (`deriveKey(root, "totp:v1")`, root =
 * `TOTP_SECRET` when set else the shared master ladder) so a compromise of one key never opens another.
 *
 * The shared secret must be recoverable to compute codes, so it's stored inside the AES-256-GCM-sealed file
 * (encrypted at rest, decryptable by the gateway). Recovery codes are one-time, so only their scrypt HASHES
 * are stored and each is deleted on use. `lastStep` is the replay lock — the highest TOTP step already
 * consumed, so a code can't be re-presented inside its validity window.
 *
 * The crypto itself (base32/HMAC/TOTP) lives in the audited `otpauth` library via `lib/totp.ts`; this file
 * only handles storage + scrypt hashing (Node built-in, memory-hard) of the recovery codes.
 */

/** scrypt cost parameters — the same profile as the password store. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

interface RecoveryHash {
  salt: string; // hex
  hash: string; // hex (scrypt output)
  N: number;
  r: number;
  p: number;
  keylen: number;
}

/** One user's 2FA enrolment. `confirmed` is false between `begin` and the user proving a first code. */
export interface TotpRecord {
  v: 1;
  secret: string; // base32 TOTP secret
  confirmed: boolean;
  createdAt: string;
  confirmedAt?: string;
  recovery: RecoveryHash[];
  lastStep: number; // replay lock: highest consumed TOTP step (0 until first use)
}

const DEV_TOTP_SECRET = "dev-totp-secret-not-for-production-use";
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** The independent root for the TOTP key domain, domain-separated from config/vault/usercreds keys. */
function totpKey(): Buffer {
  const root = process.env["TOTP_SECRET"]?.trim() || masterSecret({ dev: DEV_TOTP_SECRET });
  return deriveKey(root, "totp:v1");
}

/** The sealed file path: `TOTP_FILE`, else `totp-2fa.sealed` under OMNI_CONFIG_DIR, else null (feature off). */
function totpFile(): string | null {
  return resolveConfigFile("TOTP_FILE", "totp-2fa.sealed");
}

/** Whether the TOTP store can persist (a path resolves). Without it, app-native 2FA is unavailable. */
export function totpStoreEnabled(): boolean {
  return totpFile() !== null;
}

let cache: Record<string, TotpRecord> | null = null;
let loaded = false;

/** Reset the in-memory cache — test-only. */
export function _resetTotpCache(): void {
  cache = null;
  loaded = false;
}

function load(): Record<string, TotpRecord> {
  if (loaded && cache) return cache;
  const f = totpFile();
  cache = {};
  if (f && fs.existsSync(f)) {
    try {
      const plain = aesGcmOpen(fs.readFileSync(f, "utf8"), totpKey());
      if (plain) {
        // The sealed file could be a restored/tampered BACKUP, so parse prototype-safe (the same posture the
        // shared-state seam uses for cross-replica values), not a bare JSON.parse.
        const parsed = safeParseJson<unknown>(plain);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cache = parsed as Record<string, TotpRecord>;
      } else {
        logger.error({ file: f }, "totp-store: sealed file could not be decrypted (wrong/rotated/lost TOTP_SECRET?) — NOT overwriting");
      }
    } catch (err) {
      logger.error({ err }, "totp-store: failed to read/parse the 2FA store");
    }
  }
  loaded = true;
  return cache;
}

/** Persist the map, sealed under the TOTP key. Atomic (temp + fsync + rename), 0600 (never world-readable). */
function persist(map: Record<string, TotpRecord>): void {
  const f = totpFile();
  if (!f) throw new Error("2FA store is not configured (set OMNI_CONFIG_DIR or TOTP_FILE)");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const sealed = aesGcmSeal(JSON.stringify(map), totpKey());
  const tmp = `${f}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, sealed);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, f);
  cache = map;
  loaded = true;
}

const scrypt = (v: string, salt: Buffer, prm: { N: number; r: number; p: number; keylen: number }): Buffer =>
  scryptSync(v, salt, prm.keylen, { N: prm.N, r: prm.r, p: prm.p, maxmem: SCRYPT.maxmem });

const hashRecovery = (code: string): RecoveryHash => {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: scrypt(normalizeRecoveryCode(code), salt, SCRYPT).toString("hex"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen };
};

/** This user's record, or null. */
export function getTotp(sub: string): TotpRecord | null {
  return load()[sub] ?? null;
}

/** True iff the user has a CONFIRMED (active) TOTP enrolment. */
export function hasTotp(sub: string): boolean {
  return !!load()[sub]?.confirmed;
}

/** A client-safe status summary. */
export function totpStatus(sub: string): { enrolled: boolean; pending: boolean; recoveryRemaining: number } {
  const rec = load()[sub];
  return { enrolled: !!rec?.confirmed, pending: !!rec && !rec.confirmed, recoveryRemaining: rec?.confirmed ? rec.recovery.length : 0 };
}

/** Start (or restart) enrolment with a fresh secret. Refuses to overwrite an already-CONFIRMED enrolment —
 *  the caller must `disable` (a step-up-gated action) first, so 2FA can't be silently reset. */
export function beginEnrolment(sub: string, secret: string, now: number): void {
  if (FORBIDDEN.has(sub) || !sub) throw new Error("invalid subject");
  if (!totpStoreEnabled()) throw new Error("2FA store is not configured");
  if (load()[sub]?.confirmed) throw new Error("two-factor is already enabled; disable it first");
  const map = { ...load() };
  map[sub] = { v: 1, secret, confirmed: false, createdAt: new Date(now).toISOString(), recovery: [], lastStep: 0 };
  persist(map);
}

/** Confirm a pending enrolment: mark it active and store the recovery-code hashes. Returns false if there's
 *  no pending record. `usedStep` seeds the replay lock with the step the confirming code matched. */
export function confirmEnrolment(sub: string, recoveryCodes: string[], usedStep: number, now: number): boolean {
  const rec = load()[sub];
  if (!rec || rec.confirmed) return false;
  const map = { ...load() };
  map[sub] = { ...rec, confirmed: true, confirmedAt: new Date(now).toISOString(), recovery: recoveryCodes.map(hashRecovery), lastStep: usedStep };
  persist(map);
  return true;
}

/** Record the highest consumed step (the replay lock) after a successful verification. */
export function recordStep(sub: string, step: number): void {
  const rec = load()[sub];
  if (!rec || step <= rec.lastStep) return;
  persist({ ...load(), [sub]: { ...rec, lastStep: step } });
}

/** Consume a recovery code (constant-time over the stored hashes). Removes it on a match. */
export function consumeRecovery(sub: string, code: string): boolean {
  const rec = load()[sub];
  if (!rec || !rec.confirmed) return false;
  const norm = normalizeRecoveryCode(code);
  if (!norm) return false;
  let matched = -1;
  for (let i = 0; i < rec.recovery.length; i++) {
    const h = rec.recovery[i]!;
    const actual = scrypt(norm, Buffer.from(h.salt, "hex"), { N: h.N, r: h.r, p: h.p, keylen: h.keylen });
    if (constantTimeEqualBuf(Buffer.from(h.hash, "hex"), actual)) matched = i;
  }
  if (matched < 0) return false;
  const recovery = rec.recovery.filter((_, i) => i !== matched);
  persist({ ...load(), [sub]: { ...rec, recovery } });
  return true;
}

/** Disable 2FA for a user (remove the record). Returns whether one was present. */
export function disableTotp(sub: string): boolean {
  if (FORBIDDEN.has(sub)) return false;
  const map = load();
  if (!map[sub]) return false;
  const next = { ...map };
  delete next[sub];
  persist(next);
  return true;
}
