import type { SettingsState } from "./settings";
import { buildSnapshot, type ConfigSnapshot } from "./config-snapshot";
import { buildDefStoreExport, type DefStoreExport } from "./def-store-export";

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

/** Compose a full backup from the live settings + the current def stores. `now` keeps it deterministic. */
export function buildFullBackup(settings: SettingsState, now: string): FullBackup {
  return {
    schema: FULL_BACKUP_SCHEMA,
    version: FULL_BACKUP_VERSION,
    createdAt: now,
    settings: buildSnapshot(settings),
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
