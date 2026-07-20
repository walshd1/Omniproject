import { Router } from "express";
import {
  featureStatus,
  governanceGates,
  scopeOverrides,
} from "../lib/feature-modules";
import { manageableAtProgramme, manageableAtProject } from "../lib/feature-resolution";
import { getSettings, updateSettings, SettingsValidationError, type ScopeFeatureConfig } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { getSession } from "./auth";
import { recordRequestAudit } from "../lib/audit";
import { applySettingsGuarded } from "../lib/settings-guard";
import { getProjects } from "../lib/data";
import { programmeIdOf } from "../lib/programmes";
import { validatePredicate, type ConditionSet } from "../lib/predicate";
import type { GovernanceRule } from "../lib/governance-rules";
import type { Request } from "express";

/** The only context fields a governance rule may reference — the facts evaluable synchronously at BOTH
 *  read and enforce time, so a rule can never be shown-but-not-enforced (or vice-versa). */
const GOVERNANCE_RULE_FIELDS = new Set(["programmeId", "projectId", "projectType"]);

/**
 * Feature gating + PMO governance, resolved per scope (org → programme → project).
 *
 *  - GET  /features[?programmeId&projectId]  — the effective status for a scope (any authed session).
 *  - PUT  /features/programme/:programmeId    — a programme's policy (pmo); required/enable is bounded
 *                                               by the org-approved set (can only narrow, never grant).
 *  - PUT  /features/project/:projectId        — a project's policy (manager); bounded by the project's
 *                                               own programme (resolved server-side) or the org if standalone.
 *  Org-level gating + governance is set through PATCH /api/settings (admin):
 *  { disabledFeatures, enabledFeatures, featureGovernance }.
 *
 * Scope ownership is enforced **statelessly** against the backend (no OmniProject-held directory): the
 * caller's accessible projects are pulled live through the broker with their own forwarded token, so the
 * backend's access control IS the ownership oracle. A project is governable iff it's in that set; a
 * programme iff the caller has ≥1 project in it. A "PMO-root" who can see everything governs everything —
 * that falls out of the backend grant, nothing special-cased. Standalone projects (no programmeId) sit
 * directly under the org/PMO root.
 */
const router = Router();

/** The scopes a caller may govern, derived live from the backend (their visible project graph). */
interface GovernableScope {
  projectIds: Set<string>;
  programmeIds: Set<string>;
  /** project id → its programme link (null for standalone), so the project ceiling uses the REAL parent. */
  projectProgramme: Map<string, string | null>;
}

async function governableScope(req: Request): Promise<GovernableScope> {
  const projects = await getProjects(req);
  const projectIds = new Set<string>();
  const programmeIds = new Set<string>();
  const projectProgramme = new Map<string, string | null>();
  for (const p of projects) {
    const id = typeof p["id"] === "string" ? (p["id"] as string) : null;
    if (!id) continue;
    const prog = programmeIdOf(p);
    projectIds.add(id);
    projectProgramme.set(id, prog);
    if (prog) programmeIds.add(prog);
  }
  return { projectIds, programmeIds, projectProgramme };
}

const asStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Reserved object keys we never accept as a scope id (prototype-pollution / lookup-confusion guard). */
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** A safe programme/project key: a non-empty string that isn't a reserved prototype key. */
function safeScopeKey(id: string): boolean {
  return !!id && !PROTO_KEYS.has(id);
}

/** Read + validate a { disabled?, required?, forbidden? } body into a normalised ScopeFeatureConfig.
 *  Beyond shape, this enforces governance integrity: every id must be a real catalogue item, and a
 *  single config can't both require and forbid the same id (a self-contradiction the resolver would
 *  silently break the tie on). */
function readScopeConfig(body: unknown): ScopeFeatureConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const valid = new Set(governanceGates().map((g) => g.id));
  const list = (k: string): string[] => {
    const v = b[k];
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError(`${k} must be an array of strings`);
    }
    const ids = v as string[];
    const unknown = ids.find((id) => !valid.has(id));
    if (unknown) throw new SettingsValidationError(`"${unknown}" is not a known catalogue item`);
    return ids;
  };
  const cfg = { disabled: list("disabled"), required: list("required"), forbidden: list("forbidden") };
  const clash = cfg.required.find((id) => cfg.forbidden.includes(id));
  if (clash) throw new SettingsValidationError(`"${clash}" cannot be both required and forbidden`);
  return cfg;
}

/** Audit a governance mutation so an operator can answer "who mandated/forbade what, and when". */
function auditGovernance(req: Parameters<typeof getSession>[0], action: string, status: number, meta: Record<string, unknown>): void {
  recordRequestAudit(req, {
    category: "admin",
    action,
    result: status < 400 ? "success" : "error",
    status,
    meta,
  });
}

router.get("/features", (req, res) => {
  const programmeId = asStr(req.query["programmeId"]);
  const projectId = asStr(req.query["projectId"]);
  res.json({ features: featureStatus({ programmeId, projectId }) });
});

/** The PMO's conditional governance rules (predicate → require/forbid/disable). */
router.get("/features/governance-rules", requireRole("pmo"), (_req, res) => {
  res.json({ governanceRules: getSettings().governanceRules ?? [] });
});

/** Validate + read the governance-rule list: ids known, predicates restricted to the sync-safe fields. */
function readGovernanceRules(raw: unknown): GovernanceRule[] {
  const valid = new Set(governanceGates().map((g) => g.id));
  const out: GovernanceRule[] = [];
  for (const r of (Array.isArray(raw) ? raw : []) as unknown[]) {
    const o = r as Record<string, unknown>;
    if (!asStr(o?.["id"])) throw new SettingsValidationError("each governance rule needs an id");
    const rule: GovernanceRule = { id: o["id"] as string };
    if (asStr(o["label"])) rule.label = o["label"] as string;
    for (const k of ["require", "forbid", "disable"] as const) {
      const arr = o[k];
      if (arr == null) continue;
      if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) throw new SettingsValidationError(`${k} must be an array of strings`);
      const unknown = (arr as string[]).find((id) => !valid.has(id));
      if (unknown) throw new SettingsValidationError(`"${unknown}" is not a known catalogue item`);
      rule[k] = arr as string[];
    }
    const when = o["when"] as ConditionSet | undefined;
    if (when && typeof when === "object") {
      const preds = [...(when.all ?? []), ...(when.any ?? [])];
      for (const p of preds) {
        const err = validatePredicate(p);
        if (err) throw new SettingsValidationError(`rule "${rule.id}": ${err}`);
        if (!GOVERNANCE_RULE_FIELDS.has((p as { field: string }).field)) {
          throw new SettingsValidationError(`rule "${rule.id}": governance predicates may only use ${[...GOVERNANCE_RULE_FIELDS].join(", ")} (so read and enforce stay consistent)`);
        }
      }
      rule.when = { ...(when.all ? { all: when.all } : {}), ...(when.any ? { any: when.any } : {}) };
    }
    out.push(rule);
  }
  return out;
}

router.put("/features/governance-rules", requireRole("pmo"), async (req, res) => {
  try {
    const governanceRules = readGovernanceRules((req.body as Record<string, unknown>)?.["governanceRules"]);
    // Governing invariant (§0): governance rules ARE a control — any edit could weaken enforcement, so a
    // change is held for a signed sign-off (fail-closed; the direction of a rule edit isn't decidable here).
    const guarded = await applySettingsGuarded({ governanceRules }, getSession(req)?.sub ?? "admin");
    if (!guarded.applied) {
      recordRequestAudit(req, { category: "admin", action: "governance.rules.update", result: "success", status: 202, meta: { count: governanceRules.length, held: true } });
      res.status(202).json({ pending: guarded.pending, message: "Editing governance rules changes a control and needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    recordRequestAudit(req, { category: "admin", action: "governance.rules.update", result: "success", status: 200, meta: { count: governanceRules.length } });
    res.json({ governanceRules: getSettings().governanceRules });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

/** Resolve the caller's governable scope, failing CLOSED (403) if the backend can't be reached —
 *  a governance write must never fall back to "trust the role class". Returns null after responding. */
async function resolveScopeOrDeny(req: Request, res: import("express").Response, action: string): Promise<GovernableScope | null> {
  try {
    return await governableScope(req);
  } catch {
    auditGovernance(req, action, 403, { reason: "scope_unresolved" });
    res.status(403).json({ error: "Could not confirm which scopes you manage; governance change refused." });
    return null;
  }
}

router.put("/features/programme/:programmeId", requireRole("pmo"), async (req, res) => {
  try {
    const programmeId = String(req.params["programmeId"] ?? "");
    if (!safeScopeKey(programmeId)) { res.status(400).json({ error: "a valid programmeId is required" }); return; }
    const cfg = readScopeConfig(req.body);
    // Ownership: the caller must manage this programme — i.e. have ≥1 visible project in it. The backend
    // (queried with the caller's own token) is the authority on what they can see.
    const scope = await resolveScopeOrDeny(req, res, "governance.programme.update");
    if (!scope) return;
    if (!scope.programmeIds.has(programmeId)) {
      auditGovernance(req, "governance.programme.update", 403, { programmeId, reason: "not_owned" });
      res.status(403).json({ error: "You don't manage this programme." });
      return;
    }
    // Ceiling: a programme can only mandate/keep a feature the org already allows.
    const ceiling = manageableAtProgramme(governanceGates(), scopeOverrides());
    const escapee = cfg.required.find((id) => !ceiling.has(id));
    if (escapee) {
      auditGovernance(req, "governance.programme.update", 400, { programmeId, rejected: escapee });
      res.status(400).json({ error: `"${escapee}" is not in the org-approved set, so a programme cannot require it.` });
      return;
    }
    updateSettings({ programmeFeatures: { ...getSettings().programmeFeatures, [programmeId]: cfg } });
    auditGovernance(req, "governance.programme.update", 200, { programmeId, ...cfg });
    res.json({ programmeId, config: cfg });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

router.put("/features/project/:projectId", requireRole("manager"), async (req, res) => {
  try {
    const projectId = String(req.params["projectId"] ?? "");
    if (!safeScopeKey(projectId)) { res.status(400).json({ error: "a valid projectId is required" }); return; }
    const cfg = readScopeConfig(req.body);
    // Ownership: the project must be one the caller can see (the backend access control is the oracle).
    const scope = await resolveScopeOrDeny(req, res, "governance.project.update");
    if (!scope) return;
    if (!scope.projectIds.has(projectId)) {
      auditGovernance(req, "governance.project.update", 403, { projectId, reason: "not_owned" });
      res.status(403).json({ error: "You don't manage this project." });
      return;
    }
    // The ceiling uses the project's REAL programme (resolved server-side), never a client-supplied one —
    // so a caller can't widen their ceiling by claiming a more permissive programme.
    const programmeId = scope.projectProgramme.get(projectId) ?? null;
    const ceiling = manageableAtProject(governanceGates(), scopeOverrides({ programmeId }));
    const escapee = cfg.required.find((id) => !ceiling.has(id));
    if (escapee) {
      auditGovernance(req, "governance.project.update", 400, { projectId, programmeId, rejected: escapee });
      res.status(400).json({ error: `"${escapee}" is not available to this project's programme, so it cannot require it.` });
      return;
    }
    updateSettings({ projectFeatures: { ...getSettings().projectFeatures, [projectId]: cfg } });
    auditGovernance(req, "governance.project.update", 200, { projectId, programmeId, ...cfg });
    res.json({ projectId, config: cfg });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
