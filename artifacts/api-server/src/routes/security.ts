import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";
import { internalKeyFingerprint } from "../lib/config-crypto";
import { exportConfig } from "../lib/config-store";
import { persistSecurityState } from "../lib/security-state";
import { listKeys, revokeKey, revokeUserSessions, KEY_NAMES, type KeyName } from "../lib/key-registry";
import { auditAnchor, verifyAuditChain, type SealedAuditEvent } from "../lib/audit-chain";
import { maintenanceEngaged, maintenanceReason, engageMaintenance, releaseMaintenance } from "../lib/maintenance";

/**
 * Admin-gated key revocation. An admin can retire a signing key (session / provenance /
 * broker) — rolling it to a fresh derived version so anything signed by the revoked
 * version is rejected (sessions) or flagged untrusted (provenance) — or revoke a single
 * user's sessions. Every action is audited. RAM-only state (cleared on restart).
 */
const router = Router();

const isKeyName = (s: string): s is KeyName => (KEY_NAMES as readonly string[]).includes(s);

router.get("/security/keys", requireRole("admin"), (_req, res) => {
  res.json({ keys: listKeys() });
});

router.post("/security/keys/:name/revoke", requireRole("admin"), requireStepUp, (req, res) => {
  const name = String(req.params["name"]);
  if (!isKeyName(name)) { res.status(404).json({ error: "unknown key" }); return; }
  const session = getSession(req);
  const reason = typeof (req.body as { reason?: unknown })?.reason === "string" ? (req.body as { reason: string }).reason : undefined;
  const status = revokeKey(name, { by: session?.sub ?? null, reason });
  persistSecurityState(); // a revocation must survive a restart
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "key.revoke", actor: session ? { sub: session.sub, email: session.email } : null, write: true, meta: { key: name, newVersion: status.version, reason: reason ?? null } });
  res.json({ status });
});

router.post("/security/sessions/revoke-user", requireRole("admin"), requireStepUp, (req, res) => {
  const sub = typeof (req.body as { sub?: unknown })?.sub === "string" ? (req.body as { sub: string }).sub : "";
  if (!sub) { res.status(400).json({ error: "sub is required" }); return; }
  revokeUserSessions(sub);
  persistSecurityState();
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "sessions.revoke-user", actor: session ? { sub: session.sub, email: session.email } : null, write: true, meta: { sub } });
  res.json({ ok: true });
});

// The current internal-key FINGERPRINT (non-secret) — confirm a match without revealing.
router.get("/security/config-key", requireRole("admin"), (_req, res) => {
  res.json({ fingerprint: internalKeyFingerprint() });
});

// SECURE config export (admin + step-up). The internal at-rest key is NEVER exported:
// the live config is decrypted, re-encrypted under a one-time EPHEMERAL key, and the
// internal key is then ROTATED + the on-disk store re-sealed. Returns the portable bundle
// + the ephemeral key (the only secret that leaves, decrypting just this bundle). Audited.
router.post("/security/config/export", requireRole("admin"), requireStepUp, (req, res) => {
  const out = exportConfig();
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "config.export", actor: session ? { sub: session.sub, email: session.email } : null, write: true, result: "success", meta: { fromVersion: out.fromVersion, toVersion: out.toVersion, fingerprint: internalKeyFingerprint() } });
  res.json({
    bundle: out.bundle,
    exportKey: out.exportKey,
    warning: "Move the bundle file and keep the ephemeral key separate. The key decrypts ONLY this bundle and nothing else. Your internal at-rest key has been rotated — past copies of the live files no longer share its key.",
  });
});

// ── Maintenance lockdown (break-glass read-only mode) ────────────────────────────
// Read the current lockdown state (any admin). Surfaced on the dashboard.
router.get("/admin/maintenance", requireRole("admin"), (_req, res) => {
  res.json({ engaged: maintenanceEngaged(), reason: maintenanceReason() });
});

// Engage / release read-only lockdown (admin + step-up). While engaged, every write is
// refused with 503 except auth, this toggle, and health. Persisted so a restart can't silently
// un-freeze a deployment mid-incident. Audited.
router.put("/admin/maintenance", requireRole("admin"), requireStepUp, (req, res) => {
  const body = (req.body ?? {}) as { engaged?: unknown; reason?: unknown };
  const engage = body.engaged === true;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : "";
  if (engage) engageMaintenance(reason); else releaseMaintenance();
  persistSecurityState();
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: engage ? "maintenance.engage" : "maintenance.release", actor: session ? { sub: session.sub, email: session.email } : null, write: true, result: "success", meta: { reason } });
  res.json({ engaged: maintenanceEngaged(), reason: maintenanceReason() });
});

// ── Tamper-evident audit chain ──────────────────────────────────────────────────
// GET the current chain anchor (seq + tip hash + key version) so an external verifier can
// confirm the SIEM copy ends where the gateway says it does. Admin; no secrets exposed.
router.get("/security/audit/anchor", requireRole("admin"), (_req, res) => {
  res.json(auditAnchor());
});

// POST a slice of sealed audit events (e.g. pulled from the SIEM) to verify their integrity:
// recomputes the keyed hash chain and reports the first broken link, if any. Admin.
router.post("/security/audit/verify", requireRole("admin"), (req, res) => {
  const body = (req.body ?? {}) as { events?: unknown; expectedFirstPrev?: unknown };
  if (!Array.isArray(body.events)) { res.status(400).json({ error: "Body must be { events: SealedAuditEvent[], expectedFirstPrev? }." }); return; }
  const expectedFirstPrev = typeof body.expectedFirstPrev === "string" ? body.expectedFirstPrev : undefined;
  res.json(verifyAuditChain(body.events as SealedAuditEvent[], expectedFirstPrev));
});

export default router;
