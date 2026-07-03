import fs from "node:fs";
import path from "node:path";
import { loadConfigDir, configDirSummary, type ConfigDirSummary } from "./config-dir";
import { logger } from "./logger";

/**
 * Hot-reload the runtime config directory (OMNI_CONFIG_DIR) without a restart.
 *
 * The directory is the deployment's own folder of JSON (vendor overlays, rulesets,
 * config.json — see config-dir.ts); an operator edits it directly (their own file system /
 * git / mounted volume — entirely outside this app) and this is how the gateway is told to
 * pick the change up NOW instead of waiting for the next boot.
 *
 * Safety net for a hand-edited config: before loading, the CURRENTLY-LOADED directory is
 * backed up to a sibling `<dir>.old` (one generation — a second refresh overwrites it, this
 * is not a growing history). If the new load reports any file error, this automatically
 * reverts: restores `<dir>.old` back over `<dir>` and reloads THAT, so a typo'd edit can
 * never leave the gateway running on a half-applied broken config. `<dir>.old` is otherwise
 * kept (not deleted) on a successful refresh too — for a manual revert, or the 30-day
 * cleanup nudge (see configBackupInfo/clearConfigBackup below).
 */

const BACKUP_SUFFIX = ".old";
const STALE_BACKUP_DAYS = 30;

function backupPath(dir: string): string {
  return `${dir}${BACKUP_SUFFIX}`;
}

/** Recursively copy a directory tree, replacing `dest` if it already exists. Config
 *  directories are small and this only ever runs on an admin-triggered action, so a plain
 *  sync recursive copy is fine — no streaming/perf concern. */
function copyDirSync(src: string, dest: string): void {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

export interface ConfigRefreshResult {
  ok: boolean;
  summary: ConfigDirSummary;
  /** True when the new load failed and the last-known-good backup was restored. */
  reverted: boolean;
  /** True when this run's (successfully-loaded) state was just saved as the new `.old`
   *  backup for next time. False on a failed/reverted run — a failed attempt must never
   *  overwrite the one backup that's actually known-good. */
  backedUp: boolean;
}

/**
 * Reload the config directory now. See the module doc for the backup/auto-revert
 * behaviour.
 *
 * Order matters: the CURRENT `.old` backup is only ever refreshed AFTER a new load is
 * confirmed clean — never before. Backing it up first (then loading) would overwrite the
 * one thing that's actually known-good with the very content that might turn out broken,
 * which defeats the whole point of a "last-known-good" backup.
 */
export function refreshConfigDir(dir = process.env["OMNI_CONFIG_DIR"]?.trim()): ConfigRefreshResult {
  if (!dir) {
    // Nothing configured — loadConfigDir already reports this cleanly; nothing to back up.
    return { ok: false, summary: loadConfigDir(dir), reverted: false, backedUp: false };
  }

  const backup = backupPath(dir);
  const hadPriorBackup = fs.existsSync(backup);

  loadConfigDir(dir);
  let summary = configDirSummary();

  if (summary.errors.length > 0) {
    if (!hadPriorBackup) return { ok: false, summary, reverted: false, backedUp: false };
    logger.warn({ errors: summary.errors }, "config-refresh: new config failed to load — reverting to the last-known-good backup");
    copyDirSync(backup, dir);
    loadConfigDir(dir);
    summary = configDirSummary();
    return { ok: false, summary, reverted: true, backedUp: false };
  }

  // The new load succeeded — THIS state becomes the backup for next time.
  copyDirSync(dir, backup);
  return { ok: true, summary, reverted: false, backedUp: true };
}

export interface ConfigBackupInfo {
  present: boolean;
  ageDays: number | null;
  /** True once the backup is at/past the 30-day cleanup threshold — the SPA nudges then. */
  stale: boolean;
}

/** The `.old` backup's age, for the 30-day "go clear this out" admin nudge. */
export function configBackupInfo(dir = process.env["OMNI_CONFIG_DIR"]?.trim()): ConfigBackupInfo {
  if (!dir) return { present: false, ageDays: null, stale: false };
  const backup = backupPath(dir);
  if (!fs.existsSync(backup)) return { present: false, ageDays: null, stale: false };
  const ageDays = (Date.now() - fs.statSync(backup).mtimeMs) / 86_400_000;
  return { present: true, ageDays, stale: ageDays >= STALE_BACKUP_DAYS };
}

/** Delete the `.old` backup (admin cleanup, after the 30-day nudge or any time). */
export function clearConfigBackup(dir = process.env["OMNI_CONFIG_DIR"]?.trim()): boolean {
  if (!dir) return false;
  const backup = backupPath(dir);
  if (!fs.existsSync(backup)) return false;
  fs.rmSync(backup, { recursive: true, force: true });
  return true;
}
