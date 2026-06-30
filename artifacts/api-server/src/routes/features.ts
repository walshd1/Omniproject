import { Router } from "express";
import {
  featureStatus,
  governanceGates,
  scopeOverrides,
} from "../lib/feature-modules";
import { manageableAtProgramme, manageableAtProject } from "../lib/feature-resolution";
import { getSettings, updateSettings, SettingsValidationError, type ScopeFeatureConfig } from "../lib/settings";
import { requireRole } from "../lib/rbac";

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

/** Read + validate a { disabled?, required?, forbidden? } body into a normalised ScopeFeatureConfig. */
function readScopeConfig(body: unknown): ScopeFeatureConfig {
  const b = (body ?? {}) as Record<string, unknown>;
  const list = (k: string): string[] => {
    const v = b[k];
    if (v == null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new SettingsValidationError(`${k} must be an array of strings`);
    }
    return v as string[];
  };
  return { disabled: list("disabled"), required: list("required"), forbidden: list("forbidden") };
}

router.get("/features", (req, res) => {
  const programmeId = asStr(req.query["programmeId"]);
  const projectId = asStr(req.query["projectId"]);
  res.json({ features: featureStatus({ programmeId, projectId }) });
});

router.put("/features/programme/:programmeId", requireRole("pmo"), (req, res) => {
  try {
    const programmeId = String(req.params["programmeId"] ?? "");
    if (!programmeId) { res.status(400).json({ error: "programmeId is required" }); return; }
    const cfg = readScopeConfig(req.body);
    // Ceiling: a programme can only mandate/keep a feature the org already allows.
    const ceiling = manageableAtProgramme(governanceGates(), scopeOverrides());
    const escapee = cfg.required.find((id) => !ceiling.has(id));
    if (escapee) {
      res.status(400).json({ error: `"${escapee}" is not in the org-approved set, so a programme cannot require it.` });
      return;
    }
    updateSettings({ programmeFeatures: { ...getSettings().programmeFeatures, [programmeId]: cfg } });
    res.json({ programmeId, config: cfg });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

router.put("/features/project/:projectId", requireRole("manager"), (req, res) => {
  try {
    const projectId = String(req.params["projectId"] ?? "");
    if (!projectId) { res.status(400).json({ error: "projectId is required" }); return; }
    const programmeId = asStr(req.query["programmeId"]) || asStr((req.body as Record<string, unknown>)?.["programmeId"]);
    const cfg = readScopeConfig(req.body);
    // Ceiling: the project can only mandate within what the programme (or org, if standalone) allows.
    const ceiling = manageableAtProject(governanceGates(), scopeOverrides({ programmeId }));
    const escapee = cfg.required.find((id) => !ceiling.has(id));
    if (escapee) {
      res.status(400).json({ error: `"${escapee}" is not available to this project's programme, so it cannot require it.` });
      return;
    }
    updateSettings({ projectFeatures: { ...getSettings().projectFeatures, [projectId]: cfg } });
    res.json({ projectId, config: cfg });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
