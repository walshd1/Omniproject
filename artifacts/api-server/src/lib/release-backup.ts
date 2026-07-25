import type { SettingsState } from "./settings";
import { getSettings, updateSettings } from "./settings";
import {
  buildSealedFullBackup, openSealedFullBackup, applyExtraStores, SealedBackupError, type SealedFullBackup,
} from "./full-backup";
import { applySnapshot } from "./config-snapshot";
import { applyDefStoreExport, DefStoreImportError } from "./def-store-export";
import { collectSecurityState, applySecurityState, persistSecurityState } from "./security-state";
import { sealConfig, openConfig, isSealedConfig, internalKeyFingerprint } from "./config-crypto";
import { safeParseJson } from "./safe-json";
import { SealedFile, resolveConfigFile } from "./sealed-file";
import { loadSignedRelease } from "./release-provenance";
import { isDigest, setPromotionRecordedHook } from "./release-promotion";
import { proposeIfBound } from "./approval-gate";
import { registerApprovalExecutor } from "./approval-service";
import type { ActorContext } from "../broker/types";
import { recordAudit } from "./audit";
import { logger } from "./logger";

/**
 * Auto-backup + digest-bound restore (docs/UPDATE-MECHANISM.md §6, phase 4).
 *
 * Data ⟂ code: a code update swaps the container, but the DATA must survive and be recoverable. Before a new
 * digest is adopted, this captures the COMPLETE current state — the sealed full backup (settings + defs +
 * ai-providers/rate-card/audit stores) PLUS the security state (keys/grants/containment/kill/maintenance/
 * role-map), the leg no existing backup carried — and tags it with the CODE DIGEST it belongs to (the
 * currently-running, still-good build). Persisted sealed at rest under the deployment key.
 *
 * Rollback then has two independent moves (§6): the deploy layer repoints prod to the previous signed digest
 * (code), and — here — the pre-adopt backup is RESTORED (data). The restore is BOUND TO A DIGEST: it is
 * refused unless the rollback target equals the digest the backup was taken under, so you can only ever
 * restore the data-state that belongs to the code you're rolling back to. Restore is a posture change
 * (it overwrites live security state), so it inherits the approval spine and is human-only — exactly like a
 * promotion.
 */

export const RELEASE_BACKUP_SCHEMA = "omniproject/release-backup";
export const RELEASE_BACKUP_VERSION = 1;

/** The approval-chain action id a restore binds to — an admin can require a passkey-signed chain here. */
export const RESTORE_ACTION = "release.restore";

/**
 * A pre-adopt backup: the complete sealed system state, tagged with the code digest it belongs to (the
 * rollback target). Restoring it is valid only when rolling the code back to that same digest.
 */
export interface ReleaseBackup {
  schema: typeof RELEASE_BACKUP_SCHEMA;
  version: number;
  takenAt: string;
  /** The running build's content digest this state belongs to (sha256:…), or null when the runtime isn't
   *  running an attested build (no signed release manifest) — such a backup can't be digest-bound. */
  digest: string | null;
  /** Non-secret fingerprint of the sealing key — lets a restore confirm the right key before decrypting. */
  keyFingerprint: string;
  /** Settings + defs + extra secret stores, sealed under the deployment key (full-backup.ts). */
  full: SealedFullBackup;
  /** The security state, sealed SEPARATELY (it rides no existing backup) — sealed JSON of
   *  `collectSecurityState()`. Restored alongside the full backup on rollback. */
  security: string;
}

/** Non-secret metadata about a stored backup — safe to return over an admin API (no ciphertext, no secrets). */
export interface ReleaseBackupMeta {
  takenAt: string;
  digest: string | null;
  keyFingerprint: string;
}

const store = new SealedFile(() => resolveConfigFile("RELEASE_BACKUP_FILE"), "release backup");

/** The content digest of the build the runtime is currently running (from the signed manifest), or null. */
export function runningDigest(): string | null {
  const d = loadSignedRelease()?.manifest.digest;
  return typeof d === "string" && d ? d : null;
}

/**
 * Capture the complete current state, tag it with the running code digest, and persist it sealed. Taken while
 * the CURRENT (good) digest is live, so a later rollback to that digest can restore the exact state. Never
 * throws (persistence is best-effort via SealedFile); returns the built backup.
 */
export function captureReleaseBackup(now: string, settings: SettingsState = getSettings()): ReleaseBackup {
  const backup: ReleaseBackup = {
    schema: RELEASE_BACKUP_SCHEMA,
    version: RELEASE_BACKUP_VERSION,
    takenAt: now,
    digest: runningDigest(),
    keyFingerprint: internalKeyFingerprint(),
    full: buildSealedFullBackup(settings, now),
    security: sealConfig(JSON.stringify(collectSecurityState())),
  };
  store.write(JSON.stringify(backup));
  recordAudit({ ts: now, category: "admin", action: "release.backup.captured", write: true, result: "success", meta: { digest: backup.digest, keyFingerprint: backup.keyFingerprint } });
  logger.info({ digest: backup.digest }, "release pre-adopt backup captured");
  return backup;
}

function parseStored(raw: string): ReleaseBackup | null {
  let p: unknown;
  try { p = safeParseJson(raw); } catch { return null; }
  if (!p || typeof p !== "object") return null;
  const b = p as Partial<ReleaseBackup>;
  if (b.schema !== RELEASE_BACKUP_SCHEMA || !b.full) return null;
  return b as ReleaseBackup;
}

/** The stored pre-adopt backup, or null when none / persistence off / undecryptable. */
export function latestReleaseBackup(): ReleaseBackup | null {
  const raw = store.read();
  return raw === null ? null : parseStored(raw);
}

/** Non-secret metadata of the stored backup (for the admin API). */
export function latestReleaseBackupMeta(): ReleaseBackupMeta | null {
  const b = latestReleaseBackup();
  return b ? { takenAt: b.takenAt, digest: b.digest, keyFingerprint: b.keyFingerprint } : null;
}

/** Test seam: drop the loaded-once guard so the next read re-reads the file. */
export function __resetReleaseBackupStore(): void { store.reset(); }

export interface RestoreOutcome {
  restored: boolean;
  reason?: string;
  settingsRestored?: boolean;
  securityRestored?: boolean;
  warnings?: string[];
}

/**
 * Restore the stored pre-adopt backup — BOUND TO A DIGEST. Refused unless the target rollback digest equals
 * the digest the backup was taken under: you may only restore the data-state that belongs to the code you're
 * rolling back to. Each half runs through its own validator (settings → applySnapshot with secrets, since the
 * AES-GCM tag authenticated the sealed bundle; defs → applyDefStoreExport; extra stores → applyExtraStores;
 * security → applySecurityState). Best-effort per half so a partial bundle still restores what it has.
 */
export function restoreReleaseBackup(targetDigest: string, actorSub: string, now: string): RestoreOutcome {
  if (!isDigest(targetDigest)) return { restored: false, reason: "target must be a content digest (sha256:…)" };
  const backup = latestReleaseBackup();
  if (!backup) return { restored: false, reason: "no pre-adopt backup is available to restore" };
  if (backup.digest === null) return { restored: false, reason: "the stored backup is not bound to a digest (unattested build) — cannot bind it to a rollback" };
  if (backup.digest !== targetDigest) return { restored: false, reason: `backup digest ${backup.digest} does not match rollback target ${targetDigest}` };

  let halves: { settings: unknown; defStore: unknown; stores?: unknown };
  try { halves = openSealedFullBackup(backup.full); }
  catch (err) { return { restored: false, reason: err instanceof SealedBackupError ? err.message : "could not open sealed backup" }; }

  const warnings: string[] = [];
  let settingsRestored = false;
  if (halves.settings !== undefined) {
    try { const { patch, warnings: w } = applySnapshot(halves.settings, { allowSecrets: true }); updateSettings(patch); warnings.push(...w); settingsRestored = true; }
    catch (err) { warnings.push(`settings not restored: ${err instanceof Error ? err.message : "invalid snapshot"}`); }
  }
  if (halves.defStore !== undefined) {
    try { const r = applyDefStoreExport(halves.defStore); warnings.push(...r.warnings); }
    catch (err) { warnings.push(`defs not restored: ${err instanceof DefStoreImportError ? err.message : (err instanceof Error ? err.message : "invalid export")}`); }
  }
  if (halves.stores !== undefined) {
    try { applyExtraStores(halves.stores); }
    catch (err) { warnings.push(`extra stores not restored: ${err instanceof Error ? err.message : "invalid stores"}`); }
  }

  // Security state (keys/grants/containment/kill/maintenance/role-map) — the leg no existing backup carried.
  let securityRestored = false;
  if (typeof backup.security === "string" && isSealedConfig(backup.security)) {
    const plain = openConfig(backup.security);
    if (plain === null) warnings.push("security state not restored: could not decrypt (wrong/rotated key)");
    else {
      try { applySecurityState(safeParseJson(plain)); persistSecurityState(); securityRestored = true; }
      catch (err) { warnings.push(`security state not restored: ${err instanceof Error ? err.message : "invalid"}`); }
    }
  }

  recordAudit({ ts: now, category: "admin", action: "release.backup.restored", actor: { sub: actorSub }, write: true, result: "success", meta: { digest: targetDigest, settingsRestored, securityRestored } });
  logger.warn({ digest: targetDigest, actorSub }, "release backup restored (digest-bound rollback)");
  return { restored: true, settingsRestored, securityRestored, warnings };
}

/**
 * The "apply once approved" body for a restore proposal — restores the pre-adopt backup for the digest named
 * in the proposal params (params only ever travel the approval queue, never code). Throws when the restore is
 * refused, so a bound approval records the failure rather than reporting a silent success. Exported for tests.
 */
export function runRestoreExecutor(params: unknown): void {
  const p = (params ?? {}) as { digest?: string; actorSub?: string };
  if (!p.digest) throw new Error("release.restore executor: proposal is missing its digest");
  const outcome = restoreReleaseBackup(p.digest, p.actorSub ?? "unknown", new Date().toISOString());
  if (!outcome.restored) throw new Error(`release.restore executor: ${outcome.reason ?? "restore refused"}`);
}

/** Register the restore approval executor so a bound, passkey-approved rollback actually restores on sign-off. */
export function ensureRestoreExecutor(): void {
  registerApprovalExecutor(RESTORE_ACTION, runRestoreExecutor);
}

/** Wire the pre-adopt auto-backup: a recorded promotion captures the outgoing state before adoption (§6). */
export function ensurePreAdoptBackupHook(): void {
  setPromotionRecordedHook((_digest, now) => { captureReleaseBackup(now); });
}

export interface ProposeRestoreOutcome {
  held: boolean;
  proposalId?: string;
  outcome?: RestoreOutcome;
}

/**
 * Propose a digest-bound restore. If an approval chain is bound to `release.restore`, the run is HELD as a
 * passkey-signed proposal (nothing restored until sign-off); otherwise it restores immediately. The caller
 * (route) has already refused autonomous actors — restore, like promotion, is human-only.
 */
export async function proposeRestore(ctx: ActorContext, digest: string): Promise<ProposeRestoreOutcome> {
  const actorSub = ctx.sub ?? "unknown";
  const proposalId = await proposeIfBound(RESTORE_ACTION, { digest, actorSub }, actorSub);
  if (proposalId) return { held: true, proposalId };
  const outcome = restoreReleaseBackup(digest, actorSub, new Date().toISOString());
  return { held: false, outcome };
}
