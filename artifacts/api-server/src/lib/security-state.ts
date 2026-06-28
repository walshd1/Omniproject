import fs from "node:fs";
import { sealConfig, readMaybeSealed } from "./config-crypto";
import { snapshotKeys, restoreKeys, type KeyRegistrySnapshot } from "./key-registry";
import { listAutonomousGrants, setAutonomousGrants, type AutonomousWriteGrant } from "./autonomous-grant";
import { getContainmentRelax, setContainmentRelax, type AiContainment } from "./ai-containment";
import { listApprovedActions, listApprovedVocab, setApproved } from "./approved-actions";
import { aiKillEngaged, engageAiKill, releaseAiKill } from "./ai-kill";
import { maintenanceEngaged, maintenanceReason, engageMaintenance, releaseMaintenance } from "./maintenance";
import { logger } from "./logger";

/**
 * Durable security state.
 *
 * The security registries (key revocations, autonomous write-grants, the containment relax
 * floor, the approved-actions allowlist, the AI kill switch) are RAM-only by default — fine
 * for a stateless deployment, but on a restart a REVOKED key would un-revoke and a relaxed
 * posture would snap back to defaults. When SECURITY_STATE_FILE is set, this snapshots all
 * of it (SEALED at rest, same crypto as the config store) after every change and restores
 * it at boot — so a revocation, a grant, a relax, or an engaged kill switch survives.
 *
 * Most defaults fail SAFE (approved → reads-only, containment → full, grants → empty), so
 * the durability matters most for the things that should STAY done: revocations.
 */
const FILE = process.env["SECURITY_STATE_FILE"]?.trim();

interface SecuritySnapshot {
  keys: KeyRegistrySnapshot;
  grants: AutonomousWriteGrant[];
  containment: AiContainment;
  approved: { actions: string[]; vocab: string[] };
  aiKill: boolean;
  maintenance?: { engaged: boolean; reason: string };
}

/** Gather the current security state into one serialisable object. */
export function collectSecurityState(): SecuritySnapshot {
  return {
    keys: snapshotKeys(),
    grants: listAutonomousGrants(),
    containment: getContainmentRelax(),
    approved: { actions: listApprovedActions(), vocab: listApprovedVocab() },
    aiKill: aiKillEngaged(),
    maintenance: { engaged: maintenanceEngaged(), reason: maintenanceReason() },
  };
}

/** Apply a security snapshot to the live registries. */
export function applySecurityState(s: SecuritySnapshot): void {
  if (s.keys) restoreKeys(s.keys);
  if (s.grants) setAutonomousGrants(s.grants);
  if (s.containment) setContainmentRelax(s.containment);
  if (s.approved) setApproved(s.approved);
  if (s.aiKill) engageAiKill(); else releaseAiKill();
  if (s.maintenance?.engaged) engageMaintenance(s.maintenance.reason); else releaseMaintenance();
}

/** Persist the current security state (sealed) — no-op unless SECURITY_STATE_FILE is set. */
export function persistSecurityState(): void {
  if (!FILE) return;
  try {
    fs.writeFileSync(FILE, sealConfig(JSON.stringify(collectSecurityState())));
  } catch (err) {
    logger.warn({ err }, "security state: failed to persist");
  }
}

/** Restore the security state at boot (sealed file; plaintext tolerated for migration). */
export function loadSecurityState(): void {
  if (!FILE || !fs.existsSync(FILE)) return;
  try {
    applySecurityState(JSON.parse(readMaybeSealed(fs.readFileSync(FILE, "utf8"))) as SecuritySnapshot);
    logger.info("security state restored from disk");
  } catch (err) {
    logger.warn({ err }, "security state: failed to restore — starting from defaults");
  }
}
