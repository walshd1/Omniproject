import type { SettingsState } from "./settings";
import { buildSnapshot, type ConfigSnapshot } from "./config-snapshot";
import { buildDefStoreExport, type DefStoreExport } from "./def-store-export";
import { sealConfig, openConfig, isSealedConfig, internalKeyFingerprint } from "./config-crypto";
import { safeParseJson } from "./safe-json";

/**
 * FULL BACKUP (roadmap X.14) — ONE portable file that carries BOTH halves of what an admin owns: the settings
 * snapshot AND the def-store export (imported defs, selection bindings + locks, def-policy, custom roles). This
 * is the "take all my settings and defs to a new instance" artifact. It's a thin composition of the two
 * existing builders so each half keeps its own validation on restore; nothing new is serialised here.
 *
 * Security is inherited: no secrets or encryption keys ride along (the settings snapshot excludes durable
 * secrets by construction; the def export is decrypted plaintext re-encrypted under the target key on import),
 * and both routes that use this are admin + fresh-step-up + audited.
 */
export const FULL_BACKUP_SCHEMA = "omniproject/full-backup";
export const FULL_BACKUP_VERSION = 1;

export interface FullBackup {
  schema: typeof FULL_BACKUP_SCHEMA;
  version: number;
  createdAt: string;
  settings: ConfigSnapshot;
  defStore: DefStoreExport;
}

/** Compose a full backup from the live settings + the current def stores. `now` keeps it deterministic.
 *  `includeSecrets` captures the COMPLETE settings state (secret-bearing keys too) and is set ONLY by the
 *  encrypted (sealed) backup path — the plaintext backup leaves those keys out (see config-snapshot). */
export function buildFullBackup(settings: SettingsState, now: string, includeSecrets = false): FullBackup {
  return {
    schema: FULL_BACKUP_SCHEMA,
    version: FULL_BACKUP_VERSION,
    createdAt: now,
    settings: buildSnapshot(settings, includeSecrets),
    defStore: buildDefStoreExport(now),
  };
}

/** Structural check that `input` is a full-backup envelope, returning its two halves for the caller to apply
 *  through their own validators (`applySnapshot` / `applyDefStoreExport`). Throws on a wrong/absent schema. */
export function splitFullBackup(input: unknown): { settings: unknown; defStore: unknown } {
  if (!input || typeof input !== "object") throw new Error("backup must be a JSON object");
  const b = input as Partial<FullBackup>;
  if (b.schema !== FULL_BACKUP_SCHEMA) throw new Error(`unrecognised backup schema: ${String(b.schema)}`);
  return { settings: b.settings, defStore: b.defStore };
}

/**
 * The ENCRYPTED full backup (directive: "secrets can travel because the backup is encrypted — keep the
 * encrypted JSON + your keys and you have the whole system state"). The COMPLETE state — every setting
 * INCLUDING secrets, plus the whole def store — is serialised then SEALED with the deployment's own config
 * key (AES-256-GCM via config-crypto). Only ciphertext leaves; the key never does. Restoring on another
 * instance needs the SAME key material (SESSION_SECRET / CONFIG_KEY_RAW / KMS) — that's the "private keys" the
 * operator keeps. A non-secret key fingerprint rides along so a restore can tell "wrong key" from "corrupt".
 */
export const SEALED_BACKUP_SCHEMA = "omniproject/full-backup-sealed";
export const SEALED_BACKUP_VERSION = 1;

export interface SealedFullBackup {
  schema: typeof SEALED_BACKUP_SCHEMA;
  version: number;
  createdAt: string;
  /** Non-secret fingerprint of the sealing key — lets a restore confirm the right key before decrypting. */
  keyFingerprint: string;
  /** The complete full backup (secrets included), sealed under the deployment key. Ciphertext only. */
  sealed: string;
}

export class SealedBackupError extends Error {
  constructor(message: string) { super(message); this.name = "SealedBackupError"; }
}

/** Build the complete backup (secrets included) and SEAL it under this deployment's key. */
export function buildSealedFullBackup(settings: SettingsState, now: string): SealedFullBackup {
  const complete = buildFullBackup(settings, now, /* includeSecrets */ true);
  return {
    schema: SEALED_BACKUP_SCHEMA,
    version: SEALED_BACKUP_VERSION,
    createdAt: now,
    keyFingerprint: internalKeyFingerprint(),
    sealed: sealConfig(JSON.stringify(complete)),
  };
}

/** True when `input` looks like a sealed full-backup envelope (so a restore route can branch). */
export function isSealedFullBackup(input: unknown): input is SealedFullBackup {
  return !!input && typeof input === "object" && (input as { schema?: unknown }).schema === SEALED_BACKUP_SCHEMA;
}

/**
 * Open a sealed full backup with THIS deployment's key, returning the two halves for the caller to apply
 * (with `allowSecrets: true`, since the AES-GCM tag has authenticated that the bundle was sealed by this
 * instance's own key). Throws `SealedBackupError` on a wrong schema, a non-sealed payload, or a key that
 * can't open it (wrong/rotated/absent key material).
 */
export function openSealedFullBackup(input: unknown): { settings: unknown; defStore: unknown } {
  if (!isSealedFullBackup(input)) throw new SealedBackupError("not a sealed full-backup envelope");
  const token = (input as SealedFullBackup).sealed;
  if (typeof token !== "string" || !isSealedConfig(token)) throw new SealedBackupError("sealed payload is missing or not an encrypted token");
  const plaintext = openConfig(token);
  if (plaintext === null) throw new SealedBackupError("could not decrypt the backup with this deployment's key (wrong or rotated key material)");
  let parsed: unknown;
  // Hardened parse (prototype-pollution safe) even though the AES-GCM tag already authenticated the plaintext.
  try { parsed = safeParseJson(plaintext); }
  catch { throw new SealedBackupError("decrypted backup was not valid JSON"); }
  return splitFullBackup(parsed);
}
