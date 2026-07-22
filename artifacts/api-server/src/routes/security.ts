import { Router } from "express";
import { requireRole, setRoleMap } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getSession } from "./auth";
import { recordRequestAudit } from "../lib/audit";
import { internalKeyFingerprint } from "../lib/config-crypto";
import { exportConfig } from "../lib/config-store";
import { persistSecurityState } from "../lib/security-state";
import { listKeys, revokeKey, revokeUserSessions, KEY_NAMES, type KeyName } from "../lib/key-registry";
import { auditAnchor, verifyAuditChain, auditLogStatus, disposeAuditLog, type SealedAuditEvent } from "../lib/audit-chain";
import { signingInfo } from "../lib/signing";
import { residencyStatus } from "../lib/data-residency";
import { validateResidencyPolicy } from "../lib/residency-policy";
import { ValidationError } from "../lib/validate";
import { buildDsarReport, dsarSummaryText } from "../lib/dsar";
import { maintenanceEngaged, maintenanceReason, engageMaintenance, releaseMaintenance, publishMaintenanceToShared } from "../lib/maintenance";
import { requiresDualControl, propose, approve, reject, listProposals, registerExecutor, type Actor } from "../lib/dual-control";
import type { Request, Response } from "express";
import { v, parseOr400 } from "../lib/validate";

// Typed + bounded bodies for the admin write endpoints (untrusted input).
const REVOKE_KEY_BODY = v.object({ reason: v.optional(v.string({ trim: true, max: 500 })) });
const REVOKE_USER_BODY = v.object({ sub: v.string({ trim: true, min: 1, max: 256 }) });

/**
 * Admin-gated key revocation. An admin can retire a signing key (session / provenance /
 * broker) — rolling it to a fresh derived version so anything signed by the revoked
 * version is rejected (sessions) or flagged untrusted (provenance) — or revoke a single
 * user's sessions. Every action is audited. RAM-only state (cleared on restart).
 */
const router = Router();

const isKeyName = (s: string): s is KeyName => (KEY_NAMES as readonly string[]).includes(s);

function actorOf(req: Request): Actor { const s = getSession(req); return { sub: s?.sub ?? "?", email: s?.email }; }

/**
 * If an action requires dual control, hold it as a proposal (202) instead of executing, and
 * return true so the caller stops. The registered executor applies it once a second admin
 * approves. Returns false (proceed normally) when dual control is off for this action.
 */
export async function heldForDualControl(action: string, params: unknown, req: Request, res: Response): Promise<boolean> {
  if (!requiresDualControl(action)) return false;
  const p = await propose(action, params, actorOf(req), new Date().toISOString());
  recordRequestAudit(req, { category: "admin", action: `${action}.proposed`, write: true, result: "success", meta: { proposalId: p.id } });
  res.status(202).json({ pending: true, proposalId: p.id, message: "A second admin must approve this change before it takes effect." });
  return true;
}

// Executors — how each dual-controlled action is applied on approval (params only; no code in
// the queue). Adding an action to DUAL_CONTROL_ACTIONS without an executor here is rejected.
registerExecutor("maintenance.engage", (params) => {
  engageMaintenance((params as { reason?: string })?.reason ?? "");
  persistSecurityState();
  void publishMaintenanceToShared(); // fan the freeze out to the fleet (approved via four-eyes)
});
registerExecutor("role_map.update", (params) => {
  // Applied on second-admin approval. setRoleMap re-validates (only the five fixed roles, string
  // groups), so the queued params can't invent a role. persist ⇒ durable + fanned out to the fleet.
  setRoleMap(params);
  persistSecurityState();
});
registerExecutor("key.revoke", (params) => {
  const { name, by, reason } = params as { name: KeyName; by: string | null; reason?: string };
  revokeKey(name, { by, reason });
  persistSecurityState();
});

router.get("/security/keys", requireRole("admin"), (_req, res) => {
  res.json({ keys: listKeys() });
});

router.post("/security/keys/:name/revoke", requireRole("admin"), requireStepUp, async (req, res) => {
  const name = String(req.params["name"]);
  if (!isKeyName(name)) { res.status(404).json({ error: "unknown key" }); return; }
  const body = parseOr400(req, res, REVOKE_KEY_BODY);
  if (!body) return;
  const reason = body.reason;
  const session = getSession(req);
  // Four-eyes: when key.revoke is dual-controlled, queue it for a second admin instead.
  if (await heldForDualControl("key.revoke", { name, by: session?.sub ?? null, reason }, req, res)) return;
  const status = revokeKey(name, { by: session?.sub ?? null, reason });
  persistSecurityState(); // a revocation must survive a restart
  recordRequestAudit(req, { category: "admin", action: "key.revoke", write: true, meta: { key: name, newVersion: status.version, reason: reason ?? null } });
  res.json({ status });
});

router.post("/security/sessions/revoke-user", requireRole("admin"), requireStepUp, (req, res) => {
  const parsed = parseOr400(req, res, REVOKE_USER_BODY);
  if (!parsed) return;
  const sub = parsed.sub;
  revokeUserSessions(sub);
  persistSecurityState();
  recordRequestAudit(req, { category: "admin", action: "sessions.revoke-user", write: true, meta: { sub } });
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
  recordRequestAudit(req, { category: "admin", action: "config.export", write: true, result: "success", meta: { fromVersion: out.fromVersion, toVersion: out.toVersion, fingerprint: internalKeyFingerprint() } });
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
router.put("/admin/maintenance", requireRole("admin"), requireStepUp, async (req, res) => {
  const body = (req.body ?? {}) as { engaged?: unknown; reason?: unknown };
  const engage = body.engaged === true;
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : "";
  // Engaging a freeze is the impactful direction — gate it with four-eyes when configured;
  // releasing (recovery) stays unilateral so an incident can always be cleared.
  if (engage && await heldForDualControl("maintenance.engage", { reason }, req, res)) return;
  if (engage) engageMaintenance(reason); else releaseMaintenance();
  persistSecurityState();
  await publishMaintenanceToShared(); // fan the freeze/release out to the fleet (not just this replica)
  recordRequestAudit(req, { category: "admin", action: engage ? "maintenance.engage" : "maintenance.release", write: true, result: "success", meta: { reason } });
  res.json({ engaged: maintenanceEngaged(), reason: maintenanceReason() });
});

// ── Non-repudiation signing key (Ed25519) ─────────────────────────────────────────
// The gateway's PUBLIC verification key + status. An auditor uses this to check the
// Ed25519 signature on the audit / provenance anchors (proving the GATEWAY produced the
// chain tip, not merely that it's internally consistent). No secret is exposed.
router.get("/security/signing", requireRole("admin"), (_req, res) => {
  res.json(signingInfo());
});

// ── DSAR evidence report ───────────────────────────────────────────────────────────
// One-click "what do we hold/process for subject X" — assembled from live gateway state only
// (zero-at-rest: mostly pointers to the systems of record). Admin; the request is itself audited.
router.get("/security/dsar", requireRole("admin"), (req, res) => {
  const sub = typeof req.query["sub"] === "string" ? req.query["sub"].trim() : undefined;
  const email = typeof req.query["email"] === "string" ? req.query["email"].trim() : undefined;
  if (!sub && !email) { res.status(400).json({ error: "Provide ?sub= and/or ?email= for the data subject." }); return; }
  const report = buildDsarReport({ sub, email }, Date.now());
  recordRequestAudit(req, { category: "admin", action: "dsar.report", write: false, result: "success", meta: { subjectSub: sub ?? null, subjectEmail: email ?? null } });
  res.json({ report, summary: dsarSummaryText(report) });
});

// ── Data residency / region routing ───────────────────────────────────────────────
// The active residency policy + every configured broker endpoint's region and allow verdict
// (endpoints reduced to their ORIGIN, so a secret webhook path is never surfaced). Admin.
router.get("/security/data-residency", requireRole("admin"), (_req, res) => {
  res.json(residencyStatus());
});

// Validate a candidate per-country residency policy WITHOUT applying it (the policy is configured
// via the `DATA_RESIDENCY_POLICY` env, honouring the stateless model). An admin dry-runs the JSON
// here — same validator the seam uses — before deploying it, so a fail-closed typo is caught early.
// Admin + step-up; audited. Returns { ok, regions?, allowed? } or 400 { ok:false, issues }.
router.post("/security/data-residency/validate", requireRole("admin"), requireStepUp, (req, res) => {
  try {
    const policy = validateResidencyPolicy((req.body ?? {}) as unknown);
    recordRequestAudit(req, { category: "admin", action: "data_residency.policy.validate", write: false, result: "success", meta: { regions: Object.keys(policy.regions), allowed: policy.allowed } });
    res.json({ ok: true, regions: Object.keys(policy.regions), allowed: policy.allowed });
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    recordRequestAudit(req, { category: "admin", action: "data_residency.policy.validate", write: false, result: "error", meta: { issues: e.issues } });
    res.status(400).json({ ok: false, issues: e.issues });
  }
});

// ── Tamper-evident audit chain ──────────────────────────────────────────────────
// GET the current chain anchor (seq + tip hash + key version, plus an Ed25519 signature
// when signing is configured) so an external verifier can confirm the SIEM copy ends where
// the gateway says it does — and that the gateway attests to it. Admin; no secrets exposed.
router.get("/security/audit/anchor", requireRole("admin"), (_req, res) => {
  res.json(auditAnchor());
});

// POST a slice of sealed audit events (e.g. pulled from the SIEM) to verify their integrity:
// recomputes the keyed hash chain and reports the first broken link, if any. Admin.
router.post("/security/audit/verify", requireRole("admin"), (req, res) => {
  const body = (req.body ?? {}) as { events?: unknown; expectedFirstPrev?: unknown };
  if (!Array.isArray(body.events)) { res.status(400).json({ error: "Body must be { events: SealedAuditEvent[], expectedFirstPrev? }." }); return; }
  // verifyAuditChain recomputes a keyed hash PER event — cap the slice so a huge array can't burn CPU
  // (the explicit floor the codebase uses elsewhere: import 5000, trend ids 200). Verify in batches.
  if (body.events.length > 50_000) { res.status(413).json({ error: "Too many events: verify in slices of ≤ 50000." }); return; }
  const expectedFirstPrev = typeof body.expectedFirstPrev === "string" ? body.expectedFirstPrev : undefined;
  res.json(verifyAuditChain(body.events as SealedAuditEvent[], expectedFirstPrev));
});

// GET the status of the sealed local audit EVIDENCE log — retained count, the disposal window, the span, and
// whether it's durable at rest (a config dir is set) or RAM-only. Admin; content-free (no event bodies).
router.get("/security/audit/log", requireRole("admin"), (_req, res) => {
  res.json(auditLogStatus());
});

// POST to enforce the retention window on the evidence log NOW — prune events older than
// `historyRetention.retentionDays` (+ the hard cap). Admin + step-up (it deletes durable evidence), audited.
router.post("/security/audit/log/dispose", requireRole("admin"), requireStepUp, (req, res) => {
  const result = disposeAuditLog();
  recordRequestAudit(req, { category: "admin", action: "audit_log.dispose", write: true, result: "success", meta: result });
  res.json(result);
});

// ── Dual-control approval queue (maker-checker) ──────────────────────────────────
// The pending proposals awaiting a second approver (any admin can view the queue).
router.get("/admin/approvals", requireRole("admin"), async (_req, res) => {
  res.json({ proposals: await listProposals() });
});

// Approve + EXECUTE a proposal (admin + step-up). Enforces four-eyes: the approver must differ
// from the proposer. Returns 409 on a four-eyes / missing-executor violation.
router.post("/admin/approvals/:id/approve", requireRole("admin"), requireStepUp, async (req, res) => {
  const id = String(req.params["id"]);
  const result = await approve(id, actorOf(req), new Date().toISOString());
  if (!result.ok) { res.status(/different admin|executor/i.test(result.error ?? "") ? 409 : 404).json({ error: result.error }); return; }
  recordRequestAudit(req, { category: "admin", action: "approval.approve", write: true, result: "success", meta: { proposalId: id, approved: result.proposal?.action } });
  res.json({ ok: true, proposal: result.proposal });
});

// Reject a proposal (admin + step-up; any admin, incl. the proposer).
router.post("/admin/approvals/:id/reject", requireRole("admin"), requireStepUp, async (req, res) => {
  const id = String(req.params["id"]);
  const result = await reject(id, actorOf(req), new Date().toISOString());
  if (!result.ok) { res.status(404).json({ error: result.error }); return; }
  recordRequestAudit(req, { category: "admin", action: "approval.reject", write: true, result: "success", meta: { proposalId: id } });
  res.json({ ok: true, proposal: result.proposal });
});

export default router;
