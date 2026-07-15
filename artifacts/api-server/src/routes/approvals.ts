import { Router, type IRouter, type Request, type Response } from "express";
import { getSession } from "./auth";
import { hasRole, requireRole, ROLES } from "../lib/rbac";
import { registerCredential, credentialsFor, revokeCredentials, revokeAllCredentials, AssertionError } from "../lib/passkey";
import {
  inboxFor, challengeForStage, submitDecision, redirectProposal, bypassProposal,
  challengeForBypass, ApprovalServiceError, type SignedDecision,
} from "../lib/approval-service";
import { ApprovalChainError, type Actor, type ApproverRef } from "../lib/approval-chain";
import {
  challengeForAcceptance, acceptResponsibility, listAcceptances, revokeAcceptance,
} from "../lib/responsibility-acceptance-service";
import { ResponsibilityAcceptanceError } from "../lib/responsibility-acceptance";
import { getSettings } from "../lib/settings";
import { type Role } from "../lib/rbac";
import { recordAudit, actorForAudit } from "../lib/audit";
import { logger } from "../lib/logger";

/**
 * Approval-chain endpoints — the human, passkey-signed approver surface (design §3–4). Mounted behind
 * requireAuth. Every decision is verified (one-time challenge → passkey assertion) in the service before
 * the pure engine advances; this router only extracts the caller, validates input shape, and maps errors.
 *
 * The caller's `Actor.roles` are the RBAC roles they hold (hierarchical via `hasRole`), so a role-named
 * stage is satisfied by anyone at or above it; `via` is always `human` here (an AI approver uses a
 * separate, grant-gated path, not this browser surface). PMO-only actions gate with requireRole("pmo").
 */

const router: IRouter = Router();

function actorFor(req: Request): Actor | null {
  const s = getSession(req);
  if (!s?.sub) return null;
  return { sub: s.sub, roles: ROLES.filter((r) => hasRole(req, r)), via: "human" };
}

function str(v: unknown, max = 4096): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

/** Parse the passkey-assertion body common to a decision / bypass. */
function parseSigned(body: unknown, withDecision: boolean): SignedDecision | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const credentialId = str(b["credentialId"], 512);
  const clientDataJSON = str(b["clientDataJSON"], 8192);
  const authenticatorData = str(b["authenticatorData"], 8192);
  const signature = str(b["signature"], 8192);
  const decision = withDecision ? (b["decision"] === "reject" ? "reject" : b["decision"] === "approve" ? "approve" : null) : "approve";
  if (!credentialId || !clientDataJSON || !authenticatorData || !signature || !decision) return null;
  return { decision, credentialId, clientDataJSON, authenticatorData, signature };
}

/** Map a thrown error to a client status: auth/verify failures are 4xx, everything else 500. */
function fail(res: Response, err: unknown, req: Request, action: string): void {
  if (err instanceof AssertionError || err instanceof ApprovalServiceError || err instanceof ApprovalChainError || err instanceof ResponsibilityAcceptanceError) {
    recordAudit({ ts: new Date().toISOString(), category: "request", action, actor: actorForAudit(req), write: true, result: "error", status: 403 });
    res.status(403).json({ error: err.message });
    return;
  }
  logger.warn({ err }, `approvals: ${action} failed`);
  res.status(500).json({ error: "approval action failed" });
}

// ── Passkey enrolment ────────────────────────────────────────────────────────
// POST /approvals/passkey — register this user's passkey PUBLIC key (from the browser's create ceremony).
router.post("/approvals/passkey", async (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s?.sub) { res.status(401).json({ error: "authentication required" }); return; }
  const credentialId = str((req.body as Record<string, unknown>)?.["credentialId"], 512);
  const publicKeySpki = str((req.body as Record<string, unknown>)?.["publicKeySpki"], 4096);
  if (!credentialId || !publicKeySpki) { res.status(400).json({ error: "credentialId and publicKeySpki are required" }); return; }
  try {
    const cred = await registerCredential(s.sub, { credentialId, publicKeySpki });
    recordAudit({ ts: cred.createdAt, category: "request", action: "approval.passkey.register", actor: actorForAudit(req), write: true, result: "success" });
    res.status(201).json({ credentialId: cred.credentialId, createdAt: cred.createdAt });
  } catch (err) { fail(res, err, req, "approval.passkey.register"); }
});

// GET /approvals/passkey — this user's registered passkeys (metadata only, never key material secrets).
router.get("/approvals/passkey", async (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s?.sub) { res.status(401).json({ error: "authentication required" }); return; }
  res.json({ credentials: (await credentialsFor(s.sub)).map((c) => ({ credentialId: c.credentialId, createdAt: c.createdAt })) });
});

// ── Revocation (admin/PMO governance) ───────────────────────────────────────
// POST /approvals/passkey/revoke — revoke a NAMED user's passkeys (compromise, role change, suspension).
// Revocation is fail-SAFE (removes the ability to approve), so admin/PMO gating suffices — no chain needed.
router.post("/approvals/passkey/revoke", requireRole("pmo"), async (req: Request, res: Response) => {
  const sub = str((req.body as Record<string, unknown>)?.["sub"], 256);
  if (!sub) { res.status(400).json({ error: "sub is required" }); return; }
  await revokeCredentials(sub);
  recordAudit({ ts: new Date().toISOString(), category: "request", action: "approval.passkey.revoke", actor: actorForAudit(req), write: true, result: "success", meta: { target: sub } });
  res.json({ ok: true, sub });
});

// POST /approvals/passkey/revoke-all — revoke EVERYONE's passkeys (emergency reset). Heavily audited.
router.post("/approvals/passkey/revoke-all", requireRole("pmo"), async (req: Request, res: Response) => {
  const revoked = await revokeAllCredentials();
  recordAudit({ ts: new Date().toISOString(), category: "request", action: "approval.passkey.revoke_all", actor: actorForAudit(req), write: true, result: "success", meta: { revoked } });
  res.json({ ok: true, revoked });
});

// ── Approver surface ─────────────────────────────────────────────────────────
// GET /approvals/inbox — proposals awaiting THIS caller's decision.
router.get("/approvals/inbox", async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  res.json({ inbox: await inboxFor(actor) });
});

// POST /approvals/:id/challenge — issue a one-time challenge to sign the current stage.
router.post("/approvals/:id/challenge", async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  const c = await challengeForStage(String(req.params["id"]), actor.sub);
  if (!c) { res.status(404).json({ error: "no pending stage for this proposal" }); return; }
  res.json(c);
});

// POST /approvals/:id/decision — submit a passkey-signed approve/reject.
router.post("/approvals/:id/decision", async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  const signed = parseSigned(req.body, true);
  if (!signed) { res.status(400).json({ error: "a signed decision (decision, credentialId, clientDataJSON, authenticatorData, signature) is required" }); return; }
  try {
    const r = await submitDecision(String(req.params["id"]), actor, signed);
    recordAudit({ ts: new Date().toISOString(), category: "request", action: `approval.${signed.decision}`, actor: actorForAudit(req), write: true, result: "success", meta: { proposalId: req.params["id"], status: r.status } });
    res.json(r);
  } catch (err) { fail(res, err, req, `approval.${signed.decision}`); }
});

// ── PMO escape hatches (pmo+ only) ───────────────────────────────────────────
// POST /approvals/:id/redirect — reassign the current stage's approvers.
router.post("/approvals/:id/redirect", requireRole("pmo"), async (req: Request, res: Response) => {
  const approvers = (req.body as Record<string, unknown>)?.["approvers"];
  if (!Array.isArray(approvers) || approvers.length === 0) { res.status(400).json({ error: "approvers[] is required" }); return; }
  const parsed: ApproverRef[] = [];
  for (const a of approvers) {
    const o = a as Record<string, unknown>;
    if (o["kind"] === "role" && str(o["role"], 64)) parsed.push({ kind: "role", role: String(o["role"]) });
    else if (o["kind"] === "user" && str(o["sub"], 256)) parsed.push({ kind: "user", sub: String(o["sub"]) });
    else { res.status(400).json({ error: "each approver is {kind:'role',role} or {kind:'user',sub}" }); return; }
  }
  try {
    await redirectProposal(String(req.params["id"]), parsed);
    recordAudit({ ts: new Date().toISOString(), category: "request", action: "approval.redirect", actor: actorForAudit(req), write: true, result: "success", meta: { proposalId: req.params["id"] } });
    res.json({ ok: true });
  } catch (err) { fail(res, err, req, "approval.redirect"); }
});

// POST /approvals/:id/bypass/challenge — challenge for a PMO bypass signature.
router.post("/approvals/:id/bypass/challenge", requireRole("pmo"), async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  const c = await challengeForBypass(String(req.params["id"]), actor.sub);
  if (!c) { res.status(404).json({ error: "no pending proposal to bypass" }); return; }
  res.json(c);
});

// POST /approvals/:id/bypass — force-approve the chain with a PMO passkey signature (never silent).
router.post("/approvals/:id/bypass", requireRole("pmo"), async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  const signed = parseSigned(req.body, false);
  if (!signed) { res.status(400).json({ error: "a signed bypass (credentialId, clientDataJSON, authenticatorData, signature) is required" }); return; }
  try {
    const r = await bypassProposal(String(req.params["id"]), actor, signed);
    recordAudit({ ts: new Date().toISOString(), category: "request", action: "approval.bypass", actor: actorForAudit(req), write: true, result: "success", meta: { proposalId: req.params["id"] } });
    res.json({ status: "approved", ...r });
  } catch (err) { fail(res, err, req, "approval.bypass"); }
});

// ── AI responsibility acceptances (design §4.2) ──────────────────────────────
// The standing, passkey-signed human grant that lets an AI approve/run a SPECIFIC workflow version. A hard
// human-only act, gated to the workflow's SCOPE OWNER: PMO for an org workflow, a PM (manager) for a project
// one — selecting who takes responsibility is itself never agentic. The grant is content-hash-bound (any
// edit voids it) and voids on the signer's offboarding; recovery is the same scope owner re-signing.

/** Resolve the workflow + the role its scope requires, or respond (404/403) and return null. */
function workflowScopeGate(req: Request, res: Response, workflowId: string): boolean {
  const def = getSettings().workflows.find((w) => w.id === workflowId);
  if (!def) { res.status(404).json({ error: `unknown workflow "${workflowId}"` }); return false; }
  const need: Role = def.scope.kind === "org" ? "pmo" : "manager";
  if (!hasRole(req, need)) {
    res.status(403).json({ error: `accepting responsibility for a ${def.scope.kind} workflow is a ${need}+ (scope-owner) act` });
    return false;
  }
  return true;
}

// GET /approvals/workflow-acceptances — every stored acceptance with its LIVE active/void status (pmo+).
router.get("/approvals/workflow-acceptances", requireRole("manager"), async (_req: Request, res: Response) => {
  res.json({ acceptances: listAcceptances() });
});

// POST /approvals/workflow-acceptances/:workflowId/challenge — challenge to sign, bound to the CURRENT version.
router.post("/approvals/workflow-acceptances/:workflowId/challenge", async (req: Request, res: Response) => {
  const actor = actorFor(req);
  if (!actor) { res.status(401).json({ error: "authentication required" }); return; }
  const workflowId = String(req.params["workflowId"]);
  if (!workflowScopeGate(req, res, workflowId)) return;
  const c = await challengeForAcceptance(workflowId, actor.sub);
  if (!c) { res.status(404).json({ error: `unknown workflow "${workflowId}"` }); return; }
  res.json(c);
});

// POST /approvals/workflow-acceptances/:workflowId — record the passkey-signed acceptance (scope owner only).
router.post("/approvals/workflow-acceptances/:workflowId", async (req: Request, res: Response) => {
  const s = getSession(req);
  if (!s?.sub) { res.status(401).json({ error: "authentication required" }); return; }
  const workflowId = String(req.params["workflowId"]);
  if (!workflowScopeGate(req, res, workflowId)) return;
  const signed = parseSigned(req.body, false);
  if (!signed) { res.status(400).json({ error: "a signed acceptance (credentialId, clientDataJSON, authenticatorData, signature) is required" }); return; }
  try {
    const acceptance = await acceptResponsibility(workflowId, { sub: s.sub, email: s.email }, signed);
    recordAudit({ ts: acceptance.acceptedAt, category: "request", action: "approval.acceptance.sign", actor: actorForAudit(req), write: true, result: "success", meta: { workflowId, workflowHash: acceptance.workflowHash } });
    res.status(201).json({ accepted: true, workflowId, workflowHash: acceptance.workflowHash, acceptedAt: acceptance.acceptedAt });
  } catch (err) { fail(res, err, req, "approval.acceptance.sign"); }
});

// DELETE /approvals/workflow-acceptances/:workflowId — revoke the grant (strengthens → immediate; scope owner).
router.delete("/approvals/workflow-acceptances/:workflowId", async (req: Request, res: Response) => {
  const workflowId = String(req.params["workflowId"]);
  if (!workflowScopeGate(req, res, workflowId)) return;
  revokeAcceptance(workflowId);
  recordAudit({ ts: new Date().toISOString(), category: "request", action: "approval.acceptance.revoke", actor: actorForAudit(req), write: true, result: "success", meta: { workflowId } });
  res.json({ ok: true, workflowId });
});

export default router;
