import { Router } from "express";
import {
  featureStatus,
  governanceGates,
  scopeOverrides,
} from "../lib/feature-modules";
import { manageableAtProgramme, manageableAtProject } from "../lib/feature-resolution";
import { getSettings, updateSettings, SettingsValidationError, type ScopeFeatureConfig } from "../lib/settings";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";

/**
 * Feature gating + PMO governance, resolved per scope (org → programme → project).
 *
 *  - GET  /features[?programmeId&projectId]  — the effective status for a scope (any authed session).
 *  - PUT  /features/programme/:programmeId    — a programme's policy (pmo); required/enable is bounded
 *                                               by the org-approved set (can only narrow, never grant).
 *  - PUT  /features/project/:projectId        — a project's policy (manager); bounded by the programme
 *                                               (pass ?programmeId) or the org for a standalone project.
 *  Org-level gating + governance is set through PATCH /api/settings (admin):
 *  { disabledFeatures, enabledFeatures, featureGovernance }.
 */
const router = Router();

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
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action,
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
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

router.put("/features/programme/:programmeId", requireRole("pmo"), (req, res) => {
  try {
    const programmeId = String(req.params["programmeId"] ?? "");
    if (!safeScopeKey(programmeId)) { res.status(400).json({ error: "a valid programmeId is required" }); return; }
    const cfg = readScopeConfig(req.body);
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

router.put("/features/project/:projectId", requireRole("manager"), (req, res) => {
  try {
    const projectId = String(req.params["projectId"] ?? "");
    if (!safeScopeKey(projectId)) { res.status(400).json({ error: "a valid projectId is required" }); return; }
    const programmeId = asStr(req.query["programmeId"]) || asStr((req.body as Record<string, unknown>)?.["programmeId"]);
    const cfg = readScopeConfig(req.body);
    // Ceiling: the project can only mandate within what the programme (or org, if standalone) allows.
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
