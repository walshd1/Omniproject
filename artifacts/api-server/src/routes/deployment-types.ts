/**
 * DEPLOYMENT TYPES — the on-ramp archetypes (solo self-hoster, small team, managed cloud, enterprise
 * on-prem, regulated self-host). A user picks a type, answers a few questions, and gets a known-good setup.
 * Modelled on the methodology catalogue; the catalogue + resolver are pure (backend-catalogue), so these are
 * thin read/resolve endpoints.
 *
 *  - GET  /api/deployment-types            — the pickable list (label + description + questions).
 *  - GET  /api/deployment-types/:id        — one type (with its questions).
 *  - POST /api/deployment-types/:id/resolve — body `{ answers }` → the resolved known-good setup.
 *
 * The org runs exactly ONE deployment type at a time — an admin-gated org config with a CHANGE function:
 *  - GET  /api/deployment-type — the org's active type + resolved (override-applied) setup + settings.
 *  - PUT  /api/deployment-type — admin sets/changes it. Body `{ deploymentType, answers?, overrides? }`;
 *      `overrides` may only re-pick PICKABLE settings (broker/backend/…) to a valid option.
 */
import { Router } from "express";
import {
  deploymentTypeCatalogue, getDeploymentType, resolveDeploymentSetup,
  describeDeploymentSetup, applyDeploymentOverrides,
} from "@workspace/backend-catalogue";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { readConfigCollection, writeOrgConfigCollection } from "../lib/scoped-config";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

const DEPLOYMENT_TYPE_CONFIG = "deployment-type";
interface ActiveDeployment { deploymentType?: string; answers?: Record<string, string>; overrides?: Record<string, string> }

/** Coerce an unknown into a string→string map (drops non-string values). */
function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue; // standalone proto-key barrier
      if (typeof val === "string") out[k] = val;
    }
  }
  return out;
}

const router = Router();

router.get("/deployment-types", (_req, res) => {
  res.json({ deploymentTypes: deploymentTypeCatalogue() });
});

router.get("/deployment-types/:id", (req, res) => {
  const type = getDeploymentType(String((req.params as { id?: unknown }).id ?? ""));
  if (!type) { res.status(404).json({ error: "unknown deployment type" }); return; }
  res.json(type);
});

router.post("/deployment-types/:id/resolve", (req, res) => {
  const id = String((req.params as { id?: unknown }).id ?? "");
  const body = (req.body ?? {}) as { answers?: unknown };
  // Only string→string answers are honoured; anything else is dropped (the resolver defaults it).
  const answers: Record<string, string> = {};
  if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue; // standalone proto-key barrier
      if (typeof v === "string") answers[k] = v;
    }
  }
  const resolved = resolveDeploymentSetup(id, answers);
  if (!resolved) { res.status(404).json({ error: "unknown deployment type" }); return; }
  res.json(resolved);
});

// ── The org's ONE active deployment type (admin-gated) + the change function ──────────────────────────────
router.get("/deployment-type", (_req, res) => {
  const active = readConfigCollection<ActiveDeployment | null>(DEPLOYMENT_TYPE_CONFIG, null);
  if (!active?.deploymentType) { res.json({ deploymentType: null }); return; }
  const resolved = resolveDeploymentSetup(active.deploymentType, active.answers ?? {});
  if (!resolved) { res.json({ deploymentType: null }); return; }
  const { setup } = applyDeploymentOverrides(resolved.setup, active.overrides ?? {});
  res.json({ deploymentType: active.deploymentType, answers: resolved.answers, overrides: active.overrides ?? {}, setup, settings: describeDeploymentSetup(setup) });
});

/**
 * PUT /api/deployment-type — the org's single active deployment type; admin sets/changes it.
 *
 * LANE 2: an org-config governance verb — the admin gate rides in `gates`; the sealed-store precondition and
 * the unknown-type check are the parse gate (503 / 400). run resolves the setup, applies the pickable
 * overrides (rejecting invalid ones), writes the single org config (replacing any prior active type), and
 * returns the resolved setup + rejectedOverrides. The existing `deployment_type_set` audit moves verbatim to
 * auditMeta/auditStatus; the action base additionally stamps `write: true`, consistent with every migrated
 * command.
 */
export const deploymentTypeSetCommand: CommandDescriptor<{ id: string; answers: unknown; overrides: unknown }> = {
  name: "deployment_type_set",
  method: "put",
  path: "/deployment-type",
  gates: [requireAnyRole("admin")],
  parse: (req, res) => {
    if (!requireArtifactStore(res)) return null;
    const body = (req.body ?? {}) as { deploymentType?: unknown; answers?: unknown; overrides?: unknown };
    const id = typeof body.deploymentType === "string" ? body.deploymentType : "";
    if (!getDeploymentType(id)) { res.status(400).json({ error: "unknown deployment type" }); return null; }
    return { id, answers: body.answers, overrides: body.overrides };
  },
  run: async (_req, _res, { id, answers, overrides }) => {
    const resolved = resolveDeploymentSetup(id, strMap(answers))!;
    const { setup, rejected } = applyDeploymentOverrides(resolved.setup, strMap(overrides));
    // Store the CHOICE (type + answers + accepted overrides) as the single org config — replacing any prior
    // active type, so an org only ever runs one. This same PUT is the change function.
    const accepted = strMap(overrides);
    for (const k of rejected) delete accepted[k];
    writeOrgConfigCollection(DEPLOYMENT_TYPE_CONFIG, "Deployment type", { deploymentType: id, answers: resolved.answers, overrides: accepted });
    return { deploymentType: id, answers: resolved.answers, overrides: accepted, setup, settings: describeDeploymentSetup(setup), rejectedOverrides: rejected };
  },
  audit: "deployment_type_set",
  auditCategory: "admin",
  auditStatus: 200,
  auditMeta: (_req, { id }, result) => ({ deploymentType: id, rejected: (result as { rejectedOverrides: string[] }).rejectedOverrides.length }),
};
mountCommand(router, deploymentTypeSetCommand);

export default router;
