import { Router, type Request, type Response, type NextFunction } from "express";
import { breakGlassEnabled, hasValidBreakGlassToken } from "../lib/break-glass";
import {
  engageMaintenance, releaseMaintenance, maintenanceEngaged, maintenanceReason, publishMaintenanceToShared,
} from "../lib/maintenance";
import { revokeKey, currentVersion } from "../lib/key-registry";
import { persistSecurityState } from "../lib/security-state";
import { recordAudit } from "../lib/audit";

/**
 * Break-glass containment endpoints — the IdP-INDEPENDENT panic button for admin impersonation.
 * Authenticated by `BREAK_GLASS_TOKEN` (a local secret held out-of-band), NOT by a user session, so it
 * works when the admin identity itself can't be trusted. Deliberately limited to CONTAINMENT: it can
 * lock the deployment read-only and rotate the session key (eject every session, fleet-wide), and lift
 * that — nothing else. See lib/break-glass.ts. Mounted outside requireAuth + under a strict rate limit.
 */
const router = Router();

const BG_ACTOR = { sub: "break-glass", role: "break-glass" } as const;

/** Gate: require the break-glass token. 404 when break-glass is disabled (don't advertise the surface);
 *  401 when enabled but the token is missing/wrong. */
function breakGlassAuth(req: Request, res: Response, next: NextFunction): void {
  if (!breakGlassEnabled()) { res.status(404).json({ error: "Not found" }); return; }
  if (!hasValidBreakGlassToken(req)) {
    recordAudit({ ts: new Date().toISOString(), category: "admin", action: "break_glass.denied", actor: BG_ACTOR, write: false, result: "error", status: 401, meta: { ip: req.ip ?? null } });
    res.status(401).json({ error: "Invalid break-glass token" });
    return;
  }
  next();
}

/** Current containment posture (token-gated; no secrets). */
router.get("/break-glass/status", breakGlassAuth, (_req, res) => {
  res.json({ enabled: true, maintenance: maintenanceEngaged(), reason: maintenanceReason(), sessionKeyVersion: currentVersion("session") });
});

/**
 * LOCK DOWN NOW. Engages read-only maintenance mode AND rotates the session key — which invalidates
 * EVERY session fleet-wide (including the impersonator's), forcing a fresh sign-in for everyone. This
 * is the "assume breach, eject everyone, freeze writes" response; it fans out to the whole fleet via
 * the maintenance + key-registry shared-state sync.
 */
router.post("/break-glass/lockdown", breakGlassAuth, async (req, res) => {
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason.slice(0, 280) : "break-glass lockdown";
  engageMaintenance(reason);
  const keyStatus = revokeKey("session", { by: "break-glass", reason }); // eject all sessions fleet-wide
  persistSecurityState();
  await publishMaintenanceToShared();
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "break_glass.lockdown", actor: BG_ACTOR, write: true, result: "success", status: 200, meta: { reason, sessionKeyVersion: keyStatus.version, ip: req.ip ?? null } });
  res.json({ ok: true, maintenance: true, sessionKeyVersion: keyStatus.version, message: "Deployment locked read-only and all sessions invalidated fleet-wide. Investigate, then release." });
});

/** Lift the read-only lockdown (recovery). Sessions stay invalidated (rotation is monotonic) — users
 *  simply sign in again. Releasing does NOT re-grant anything, so it can't be used to escalate. */
router.post("/break-glass/release", breakGlassAuth, async (req, res) => {
  releaseMaintenance();
  persistSecurityState();
  await publishMaintenanceToShared();
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "break_glass.release", actor: BG_ACTOR, write: true, result: "success", status: 200, meta: { ip: req.ip ?? null } });
  res.json({ ok: true, maintenance: false, message: "Read-only lockdown lifted. Sessions rotated during lockdown remain invalidated." });
});

export default router;
