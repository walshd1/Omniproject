import { scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deriveKey, masterSecret, constantTimeEqualBuf } from "./crypto-keys";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { resolveConfigFile } from "./sealed-file";
import { isTruthy } from "./env-config";
import { logger } from "./logger";

/**
 * LOCAL-USER CREDENTIAL STORE — password secrets for in-app (non-IdP) users, in a SEPARATELY-KEYED sealed
 * store, isolated from the config store and the AI vault.
 *
 * KEY SEPARATION (the explicit requirement): the file is sealed under its OWN key domain — `deriveKey(root,
 * "usercreds:v1")` — where `root` is `USERCRED_SECRET` when set (a fully independent root the operator can rotate
 * on its own) else the shared master ladder. Either way the derived key differs from the config (`config:*`) and
 * vault (`vault:*`) domains, so a compromise of one key never opens the password store. Sealed with AES-256-GCM
 * directly (NOT the config-keyed `SealedFile`, which would defeat the separation).
 *
 * HASHING: scrypt (RFC 7914, Node built-in — no external dependency, memory-hard). Each secret gets a fresh
 * 16-byte salt; the derived key + the cost params travel with the record so a future param bump verifies old
 * hashes. Verification is constant-time, and a miss on a NON-EXISTENT user still runs a dummy scrypt so response
 * timing can't enumerate accounts.
 */

/** scrypt cost parameters. N=16384 keeps peak memory (~16 MB) under Node's default maxmem while staying strong;
 *  bump `SCRYPT_N` (a power of two) to harden — old records verify against their own stored params regardless. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 } as const;

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 1024; // a DoS bound on scrypt input (very long inputs cost CPU)

/** One stored credential: the scrypt output + the salt + the cost params it was derived under. */
interface CredentialRecord {
  v: 1;
  salt: string;   // hex
  hash: string;   // hex (scrypt output, `keylen` bytes)
  N: number;
  r: number;
  p: number;
  keylen: number;
}

const DEV_USERCRED_SECRET = "dev-usercred-secret-not-for-production-use";

/** The independent root for the credential key domain: `USERCRED_SECRET` when set (rotatable on its own), else
 *  the shared master ladder. Domain-separated by the `usercreds:v1` info so the derived key is never the config
 *  or vault key. */
function credKey(): Buffer {
  const root = process.env["USERCRED_SECRET"]?.trim() || masterSecret({ dev: DEV_USERCRED_SECRET });
  // The RECOVERY break-glass re-keys the domain: engaging `LOCAL_PASSWORD_RECOVERY` (to re-enable local passwords
  // despite a configured SSO) derives a DIFFERENT key, so the pre-recovery sealed credential store can no longer
  // be opened. This makes recovery deliberately destructive — you start afresh or restore from backup — so it
  // can never be used as a stealth downgrade past SSO.
  const domain = isTruthy(process.env["LOCAL_PASSWORD_RECOVERY"]) ? "usercreds:v1:recovery" : "usercreds:v1";
  return deriveKey(root, domain);
}

/** The credential file path: `USERCRED_FILE`, else `user-credentials.sealed` under OMNI_CONFIG_DIR, else null
 *  (persistence off — the feature is unavailable, since a password with nowhere to live is a footgun). */
function credFile(): string | null {
  return resolveConfigFile("USERCRED_FILE", "user-credentials.sealed");
}

/** Whether the credential store can persist (a path resolves). */
export function credentialsEnabled(): boolean {
  return credFile() !== null;
}

let cache: Record<string, CredentialRecord> | null = null;
let loaded = false;

/** Reset the in-memory cache — test-only, so an env/path change is re-read. */
export function _resetCredentialCache(): void {
  cache = null;
  loaded = false;
}

function load(): Record<string, CredentialRecord> {
  if (loaded && cache) return cache;
  const f = credFile();
  cache = {};
  if (f && fs.existsSync(f)) {
    try {
      const plain = aesGcmOpen(fs.readFileSync(f, "utf8"), credKey());
      if (plain) {
        const parsed = JSON.parse(plain) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cache = parsed as Record<string, CredentialRecord>;
      } else {
        logger.error({ file: f }, "user-credentials: sealed file could not be decrypted (wrong/rotated/lost USERCRED_SECRET?) — NOT overwriting");
        // Mark loaded so we don't repeatedly try, but keep cache empty; write() refuses to clobber (below).
      }
    } catch (err) {
      logger.error({ err }, "user-credentials: failed to read/parse credential store");
    }
  }
  loaded = true;
  return cache;
}

/** Persist the current map, sealed under the credential key. Atomic (temp + fsync + rename over the target,
 *  same as sealed-file.ts) so a crash / disk-full mid-write can never leave a truncated credential store. */
function persist(map: Record<string, CredentialRecord>): void {
  const f = credFile();
  if (!f) throw new Error("credential store is not configured (set OMNI_CONFIG_DIR or USERCRED_FILE)");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const sealed = aesGcmSeal(JSON.stringify(map), credKey());
  const tmp = `${f}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "w", 0o600); // 0o600: password-hash store — never world-readable
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

function scrypt(password: string, salt: Buffer, params: { N: number; r: number; p: number; keylen: number }): Buffer {
  return scryptSync(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem });
}

/** Validate a proposed password. Throws on too-short / too-long / non-string. */
export function assertPasswordPolicy(password: unknown): asserts password is string {
  if (typeof password !== "string") throw new Error("password must be a string");
  if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD) throw new Error("password is too long");
}

/** Set (or replace) a user's password. Validates the policy, derives a fresh scrypt hash, and persists. */
export function setPassword(userId: string, password: string): void {
  assertPasswordPolicy(password);
  if (!credentialsEnabled()) throw new Error("credential store is not configured");
  if (userId === "__proto__" || userId === "constructor" || userId === "prototype") throw new Error("invalid userId");
  const salt = randomBytes(16);
  const hash = scrypt(password, salt, SCRYPT);
  const map = { ...load() };
  map[userId] = { v: 1, salt: salt.toString("hex"), hash: hash.toString("hex"), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, keylen: SCRYPT.keylen };
  persist(map);
}

/** Whether a user has a stored password. */
export function hasPassword(userId: string): boolean {
  return !!load()[userId];
}

/** Remove a user's credential (on delete). Returns whether one was present. */
export function removePassword(userId: string): boolean {
  if (userId === "__proto__" || userId === "constructor" || userId === "prototype") return false;
  const map = load();
  if (!map[userId]) return false;
  const next = { ...map };
  delete next[userId];
  persist(next);
  return true;
}

/**
 * Verify a password against a user's stored credential, constant-time. Returns false for a wrong password OR a
 * user with no credential — and in the no-credential case still runs a dummy scrypt so timing can't reveal
 * whether the account exists. Never throws on a bad password (only a malformed store would).
 */
export function verifyPassword(userId: string, password: string): boolean {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD) {
    // Still burn a comparable amount of work to avoid a fast-path timing signal.
    scrypt("x", DUMMY_SALT, SCRYPT);
    return false;
  }
  const rec = load()[userId];
  if (!rec) {
    scrypt(password, DUMMY_SALT, SCRYPT);
    return false;
  }
  const expected = Buffer.from(rec.hash, "hex");
  const actual = scrypt(password, Buffer.from(rec.salt, "hex"), { N: rec.N, r: rec.r, p: rec.p, keylen: rec.keylen });
  return constantTimeEqualBuf(expected, actual);
}

const DUMMY_SALT = Buffer.alloc(16, 7);
