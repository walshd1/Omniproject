import type { SettingsState } from "./settings";
import { buildFullBackup, splitFullBackup } from "./full-backup";
import { aesGcmSeal, aesGcmOpen } from "./crypto-aes-gcm";
import { fingerprint } from "./crypto-keys";
import { safeParseJson } from "./safe-json";

/**
 * PORTABLE BACKUP — the complete instance backup (settings + def store + secret stores) sealed under the
 * INSTANCE RECOVERY KEY (lib/instance-key), NOT the deployment's config key. That decoupling is the point: a
 * portable backup travels to a brand-new box and is opened with the key the operator SAVED offline — the exact
 * "lose the box, restore from the encrypted backup with your saved key" flow. The key is a user-held secret, so
 * ciphertext is all that ever leaves.
 */

export const PORTABLE_BACKUP_SCHEMA = "omniproject/portable-backup";
export const PORTABLE_BACKUP_VERSION = 1;

export interface PortableBackup {
  schema: typeof PORTABLE_BACKUP_SCHEMA;
  version: number;
  createdAt: string;
  /** Non-secret fingerprint of the sealing IRK — lets restore confirm "this is the right key" before decrypting. */
  keyFingerprint: string;
  /** The complete full backup (secrets included), sealed under the IRK. Ciphertext only. */
  sealed: string;
}

export class PortableBackupError extends Error {
  constructor(message: string) { super(message); this.name = "PortableBackupError"; }
}

/** Build the complete backup and seal it under the raw IRK. `now` keeps it deterministic. */
export function buildPortableBackup(settings: SettingsState, now: string, irk: Buffer): PortableBackup {
  const complete = buildFullBackup(settings, now, /* includeSecrets */ true);
  return {
    schema: PORTABLE_BACKUP_SCHEMA,
    version: PORTABLE_BACKUP_VERSION,
    createdAt: now,
    keyFingerprint: fingerprint(irk),
    sealed: aesGcmSeal(JSON.stringify(complete), irk),
  };
}

/** True when `input` looks like a portable-backup envelope (so a restore route can branch/validate). */
export function isPortableBackup(input: unknown): input is PortableBackup {
  return !!input && typeof input === "object" && (input as { schema?: unknown }).schema === PORTABLE_BACKUP_SCHEMA;
}

/**
 * Open a portable backup with the raw IRK the operator supplies, returning the two halves for the caller to
 * apply (`applySnapshot` / `applyDefStoreExport` / `applyExtraStores`, with `allowSecrets` since the AES-GCM tag
 * has authenticated the bundle). Throws {@link PortableBackupError} on a wrong schema or a key that can't open
 * it — the caller maps that to "wrong recovery key".
 */
export function openPortableBackup(input: unknown, irk: Buffer): { settings: unknown; defStore: unknown; stores?: unknown } {
  if (!isPortableBackup(input)) throw new PortableBackupError("not a portable-backup envelope");
  const token = (input as PortableBackup).sealed;
  if (typeof token !== "string" || !token) throw new PortableBackupError("backup is missing its sealed payload");
  const plaintext = aesGcmOpen(token, irk);
  if (plaintext === null) throw new PortableBackupError("could not decrypt the backup with that recovery key (wrong key)");
  let parsed: unknown;
  try { parsed = safeParseJson(plaintext); }
  catch { throw new PortableBackupError("decrypted backup was not valid JSON"); }
  return splitFullBackup(parsed);
}
