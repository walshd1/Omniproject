import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { aiContainmentLevel, aiSourceLevel, getContainmentRelax, setContainmentRelax, type AiContainment } from "../lib/ai-containment";
import { listAutonomousGrants } from "../lib/autonomous-grant";
import { aiKillEngaged, engageAiKill, releaseAiKill } from "../lib/ai-kill";
import { listApprovedActions, listApprovedVocab, setApproved, approveAction, revokeApprovedAction, approveTerm, isActionApproved, actionScope, type ActionScope } from "../lib/approved-actions";
import { MCP_TOOLS } from "../lib/mcp";
import { persistSecurityState } from "../lib/security-state";
import { recordAudit } from "../lib/audit";
import { captureVersion } from "../lib/config-store";
import { getSession } from "./auth";
import {
  listResolvedCapabilities, listSurfaces, setCapabilityState, noteCapabilityConfigured,
  recentCapabilityLog, checkEndpointReachable, getCapability, UnknownCapabilityError,
} from "../lib/tools";
import { getSettings } from "../lib/settings";
import { v, parseOr400 } from "../lib/validate";

/**
 * Capability governance plane — the admin-set deployment state (off / user-defined /
 * public, and per-surface for AI tools) of every AI tool, the MCP, AI providers and
 * vendors (see lib/tools).
 *
 *  - GET /api/governance         — every capability with its offered states + current
 *                                  setting (readable by any authenticated session, so
 *                                  the UI can honour the states).
 *  - PUT /api/governance/:id     — set one capability's state/endpoint/surfaces (admin).
 */
const router = Router();

router.get("/governance", (_req, res) => {
  res.json({ capabilities: listResolvedCapabilities(), surfaces: listSurfaces() });
});

// Live activity for the admin governance dashboard (uses, blocks, config changes).
router.get("/governance/log", requireRole("admin"), (_req, res) => {
  res.json({ entries: recentCapabilityLog() });
});

// Autonomous posture for the admin dashboard: the ENFORCED containment level + how it's
// derived (the AI source floor and the admin relax setting) + the active write grants.
router.get("/governance/autonomous", requireRole("admin"), (_req, res) => {
  res.json({ level: aiContainmentLevel(), source: aiSourceLevel(), relax: getContainmentRelax(), grants: listAutonomousGrants(), aiKill: aiKillEngaged() });
});

// The customer-wide APPROVED vocabulary + actions allowlist (read: any admin).
router.get("/governance/approved", requireRole("admin"), (_req, res) => {
  res.json({ actions: listApprovedActions(), vocab: listApprovedVocab() });
});

// The full AI ACTION CATALOGUE (every canonical action) annotated with its approved
// state — populates the AI admin screen so approval is a visible per-action toggle, not
// a blind allowlist. The catalogue is the superset; approving makes an action possible.
router.get("/governance/actions", requireRole("admin"), (_req, res) => {
  // Dedup by canonical action (read + write tools can share one); writes are the gated ones.
  // `approved` reflects whether the action is on the allowlist at all; `scope` carries any
  // per-surface/role/backend narrowing so the admin UI can show and edit the matrix.
  const seen = new Map<string, { action: string; label: string; description: string; write: boolean; approved: boolean; scope: ActionScope }>();
  for (const t of MCP_TOOLS) {
    if (!seen.has(t.action)) seen.set(t.action, { action: t.action, label: t.name, description: t.description, write: !!t.write, approved: actionScope(t.action) !== undefined, scope: actionScope(t.action) ?? {} });
  }
  res.json({ actions: [...seen.values()], surfaces: listSurfaces().map((s) => s.id) });
});

// Extend / replace the approved allowlist (admin + step-up — widening what AI may do is
// a sensitive change). `replace` swaps the whole file; otherwise the items are added.
router.put("/governance/approved", requireRole("admin"), requireStepUp, (req, res) => {
  const body = (req.body ?? {}) as { actions?: unknown; rules?: unknown; remove?: unknown; vocab?: unknown; replace?: unknown };
  const acts = Array.isArray(body.actions) ? body.actions.filter((a): a is string => typeof a === "string") : undefined;
  const remove = Array.isArray(body.remove) ? body.remove.filter((a): a is string => typeof a === "string") : undefined;
  const terms = Array.isArray(body.vocab) ? body.vocab.filter((v): v is string => typeof v === "string") : undefined;
  // Scoped approvals: { action, scope:{surfaces?,minRole?,backends?} } — re-approving an
  // action with a scope narrows it (cleanScope drops invalid fields). Empty scope = global.
  const rules = Array.isArray(body.rules)
    ? body.rules.filter((r): r is { action: string; scope?: ActionScope } => !!r && typeof (r as { action?: unknown }).action === "string")
    : undefined;
  if (body.replace === true) {
    setApproved({ ...(rules ? { rules: rules.map((r) => ({ action: r.action, scope: r.scope ?? {} })) } : acts ? { actions: acts } : {}), ...(terms ? { vocab: terms } : {}) });
  } else {
    for (const a of acts ?? []) approveAction(a);
    for (const r of rules ?? []) approveAction(r.action, r.scope); // set/replace the action's scope
    for (const a of remove ?? []) revokeApprovedAction(a);
    for (const v of terms ?? []) approveTerm(v);
  }
  const session = getSession(req);
  persistSecurityState();
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: "approved.update", actor: session ? { sub: session.sub, email: session.email } : null, write: true, result: "success", meta: { actions: listApprovedActions().length, vocab: listApprovedVocab().length } });
  res.json({ actions: listApprovedActions(), vocab: listApprovedVocab() });
});

// Break-glass AI kill switch (admin + step-up): one toggle stops all AI calls and
// suspends every autonomous write. Audited; grants are left intact so release restores them.
router.put("/governance/ai-kill", requireRole("admin"), requireStepUp, (req, res) => {
  const engage = (req.body as { engage?: unknown }).engage === true;
  if (engage) engageAiKill(); else releaseAiKill();
  persistSecurityState();
  const session = getSession(req);
  recordAudit({ ts: new Date().toISOString(), category: "admin", action: engage ? "ai-kill.engage" : "ai-kill.release", actor: session ? { sub: session.sub, email: session.email } : null, write: true, result: "success" });
  res.json({ aiKill: aiKillEngaged() });
});

// Relax (or re-tighten) the default-full containment posture (admin + step-up). The AI
// source level remains a hard floor, so a remote/public AI can never be relaxed below max.
const CONTAINMENT_LEVELS: readonly AiContainment[] = ["off", "local", "remote", "public"];
const CONTAINMENT_BODY = v.object({ level: v.enum(CONTAINMENT_LEVELS) });
const TEST_BODY = v.object({ endpoint: v.optional(v.string({ trim: true, max: 2_000 })) });
router.put("/governance/containment", requireRole("admin"), requireStepUp, (req, res) => {
  const parsed = parseOr400(req, res, CONTAINMENT_BODY);
  if (!parsed) return;
  setContainmentRelax(parsed.level);
  persistSecurityState();
  res.json({ relax: getContainmentRelax(), level: aiContainmentLevel(), source: aiSourceLevel() });
});

// Probe a user-defined endpoint's reachability (admin). Tests the endpoint in the
// request body, or the one already stored for the capability.
router.post("/governance/:id/test", requireRole("admin"), async (req, res) => {
  const id = String(req.params["id"]);
  if (!getCapability(id)) { res.status(404).json({ error: "unknown capability" }); return; }
  const body = parseOr400(req, res, TEST_BODY);
  if (!body) return;
  const endpoint = (body.endpoint && body.endpoint.trim())
    ? body.endpoint
    : (getSettings().capabilityStates[id]?.endpoint ?? "");
  res.json(await checkEndpointReachable(String(endpoint)));
});

// Changing any capability's deployment state is an admin decision, and versioned so
// it can be rolled back like any other config change.
router.put("/governance/:id", requireRole("admin"), requireStepUp, (req, res) => {
  const id = String(req.params["id"]);
  const session = getSession(req);
  try {
    const setting = setCapabilityState(id, req.body ?? {});
    noteCapabilityConfigured(id, setting, session ? { sub: session.sub, email: session.email, role: session.roles?.[0] } : null);
    captureVersion(`capability ${id} set`);
    res.json({ setting });
  } catch (err) {
    if (err instanceof UnknownCapabilityError) { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
