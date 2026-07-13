import { SealedFile, resolveConfigFile } from "./sealed-file";
import { snapshotKeys, restoreKeys, type KeyRegistrySnapshot } from "./key-registry";
import { listAutonomousGrants, setAutonomousGrants, type AutonomousWriteGrant } from "./autonomous-grant";
import { getContainmentRelax, setContainmentRelax, isContainmentLevel, type AiContainment } from "./ai-containment";
import { listApprovedActions, listApprovedActionRules, listApprovedVocab, setApproved, type ActionApproval } from "./approved-actions";
import { aiKillEngaged, engageAiKill, releaseAiKill } from "./ai-kill";
import { maintenanceEngaged, maintenanceReason, engageMaintenance, releaseMaintenance } from "./maintenance";
import { sharedKv, sharedStateMode } from "./shared-state";
import { safeParseJson } from "./safe-json";
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
const store = new SealedFile(() => resolveConfigFile("SECURITY_STATE_FILE"), "security state");

interface SecuritySnapshot {
  keys: KeyRegistrySnapshot;
  grants: AutonomousWriteGrant[];
  containment: AiContainment;
  // `actions` (ids) is kept for back-compat with older sealed files; `rules` carries the
  // per-surface/role/backend scopes and wins on restore when present.
  approved: { actions: string[]; vocab: string[]; rules?: ActionApproval[] };
  aiKill: boolean;
  maintenance?: { engaged: boolean; reason: string };
}

/** Gather the current security state into one serialisable object. */
export function collectSecurityState(): SecuritySnapshot {
  return {
    keys: snapshotKeys(),
    grants: listAutonomousGrants(),
    containment: getContainmentRelax(),
    approved: { actions: listApprovedActions(), vocab: listApprovedVocab(), rules: listApprovedActionRules() },
    aiKill: aiKillEngaged(),
    maintenance: { engaged: maintenanceEngaged(), reason: maintenanceReason() },
  };
}

/** Apply a security snapshot to the live registries. */
export function applySecurityState(s: SecuritySnapshot): void {
  if (s.keys) restoreKeys(s.keys);
  if (s.grants) setAutonomousGrants(s.grants);
  if (s.containment) setContainmentRelax(s.containment);
  if (s.approved) setApproved(s.approved); // rules wins when present, else falls back to actions ids
  if (s.aiKill) engageAiKill(); else releaseAiKill();
  if (s.maintenance?.engaged) engageMaintenance(s.maintenance.reason); else releaseMaintenance();
}

/** Persist the current security state (sealed) — no-op unless SECURITY_STATE_FILE is set — AND fan the
 *  AI-authorization controls out to the fleet so a change (crucially a REVOCATION) propagates to every
 *  replica, not just the one that served it. The local sealed file remains the single-replica durable
 *  store; the shared publish is best-effort and additive. */
export function persistSecurityState(): void {
  store.write(JSON.stringify(collectSecurityState()));
  void publishAiAuthzToShared();
}

// ── AI-authorization fleet-sync ─────────────────────────────────────────────────────
// The autonomous write-grants, the containment relax-floor, and the approved-actions allowlist are
// ELEVATION controls (they decide what an autonomous/AI actor may do). Like the key-revocation, AI
// kill-switch, SCIM, and maintenance controls, they must be fleet-consistent — otherwise a grant
// revoked (or containment tightened, or an action un-approved) on one replica stays effective on the
// other N-1, a lateral-privilege gap. This mirrors the AI kill-switch / maintenance pattern: publish
// on change, converge on a Redis-backed poll; single-replica (in-process) keeps its durable local file.
const AI_AUTHZ_KEY = "security:fleet:ai-authz";

interface AiAuthzSnapshot {
  grants: AutonomousWriteGrant[];
  containment: AiContainment;
  approved: { actions: string[]; vocab: string[]; rules?: ActionApproval[] };
}

function collectAiAuthz(): AiAuthzSnapshot {
  return {
    grants: listAutonomousGrants(),
    containment: getContainmentRelax(),
    approved: { actions: listApprovedActions(), vocab: listApprovedVocab(), rules: listApprovedActionRules() },
  };
}

/** Fan this replica's AI-authz controls out to shared state. Best-effort — the local state is already
 *  set, so a shared-state blip never blocks the operator's change on the handling replica. */
export async function publishAiAuthzToShared(): Promise<void> {
  try { await sharedKv.set(AI_AUTHZ_KEY, JSON.stringify(collectAiAuthz())); }
  catch { /* best-effort fan-out */ }
}

/**
 * Converge this replica's AI-authz controls with the fleet's shared value. Redis-only (a single-replica
 * deployment is per-process and its durable local file is authoritative). The shared blob is treated as
 * UNTRUSTED cross-replica input — it is safe-parsed (prototype-pollution-stripped) and applied ONLY
 * through the VALIDATING setters, each of which drops malformed entries and fails toward the strict/
 * current posture. So a corrupt or hostile fleet message can never WIDEN authorization here.
 */
export async function refreshAiAuthzFromShared(): Promise<void> {
  if (sharedStateMode() !== "redis") return;
  let raw: string | null;
  try { raw = await sharedKv.get(AI_AUTHZ_KEY); } catch { return; }
  if (raw === null) return; // nothing published yet — keep local
  let parsed: unknown;
  try { parsed = safeParseJson(raw); } catch { return; } // malformed → keep current posture (fail safe)
  if (!parsed || typeof parsed !== "object") return;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj["grants"])) setAutonomousGrants(obj["grants"]);
  if (isContainmentLevel(obj["containment"])) setContainmentRelax(obj["containment"]);
  const approved = obj["approved"];
  if (approved && typeof approved === "object") {
    setApproved(approved as { actions?: string[]; rules?: ActionApproval[]; vocab?: string[] });
  }
}

let aiAuthzTimer: ReturnType<typeof setInterval> | null = null;
/** Start periodic AI-authz fleet convergence (idempotent, unref'd). Returns a stop handle. */
export function startAiAuthzFleetSync(intervalMs = 3000): () => void {
  if (!aiAuthzTimer) {
    aiAuthzTimer = setInterval(() => { void refreshAiAuthzFromShared(); }, intervalMs);
    aiAuthzTimer.unref?.();
  }
  return stopAiAuthzFleetSync;
}
/** Stop the AI-authz fleet-sync poll (idempotent) — shutdown / tests. */
export function stopAiAuthzFleetSync(): void {
  if (aiAuthzTimer) { clearInterval(aiAuthzTimer); aiAuthzTimer = null; }
}

/** Restore the security state at boot (sealed file; plaintext tolerated for migration). */
export function loadSecurityState(): void {
  const raw = store.read();
  if (raw === null) return;
  try {
    applySecurityState(JSON.parse(raw) as SecuritySnapshot);
    logger.info("security state restored from disk");
  } catch (err) {
    logger.warn({ err }, "security state: failed to restore — starting from defaults");
  }
}
