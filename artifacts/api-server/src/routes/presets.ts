import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireRole } from "../lib/rbac";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import type { IssueWrite } from "../broker/types";
import { readConfigCollection } from "../lib/scoped-config";
import { planInstantiation } from "../lib/project-template";
import { applyRuleset } from "../lib/ruleset";
import { recordRequestAudit } from "../lib/audit";
import { planPresetApply, PresetError } from "../lib/preset-apply";
import { presetCatalogue, getPreset, type ProjectTemplate } from "@workspace/backend-catalogue";

/**
 * QUICK-LOAD PRESETS — land an org on a way of working in one action. A preset is a first-class bundle that
 * references the pieces that already exist (a methodology, a reference ruleset, a starter project template, a
 * persona dashboard, a posture blueprint). This route lists them and APPLIES one: it runs the server-side
 * pieces (apply the reference ruleset, instantiate the starter project via the broker) and returns FOLLOW-UPS
 * the SPA finishes (curate the methodology composition — which needs the full catalogue item set the SPA holds
 * — plus the optional posture blueprint + persona dashboard). Read is viewer+; apply needs pmo (it applies a
 * ruleset org-wide and creates a project).
 */
const router = Router();

// GET /api/presets — the quick-load preset catalogue.
router.get("/presets", requireRole("viewer"), (_req, res) => {
  res.json(presetCatalogue());
});

// GET /api/presets/:id — one preset.
router.get("/presets/:id", requireRole("viewer"), (req, res) => {
  const preset = getPreset(String((req.params as { id?: unknown }).id ?? ""));
  if (!preset) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json(preset);
});

// POST /api/presets/:id/apply — apply the preset (pmo). Body: { name?, programmeId? } for the starter project.
router.post("/presets/:id/apply", requireRole("pmo"), (req, res) => {
  let plan;
  try {
    plan = planPresetApply(String((req.params as { id?: unknown }).id ?? ""), readConfigCollection<ProjectTemplate[]>("templates", []));
  } catch (e) {
    if (e instanceof PresetError) { res.status(e.status).json({ error: e.message }); return; }
    throw e;
  }

  return withBrokerErrors(req, res, "apply preset failed", async () => {
    const applied: { referenceRuleset?: string; project?: { id: string; seeded: number } } = {};

    // 1) Apply the reference ruleset (field/mode rules for the methodology).
    if (plan.rulesetBundle) {
      applyRuleset({ modes: plan.rulesetBundle.modes, fieldRules: plan.rulesetBundle.fieldRules });
      if (plan.preset.referenceRuleset) applied.referenceRuleset = plan.preset.referenceRuleset;
    }

    // 2) Instantiate the starter project + seed its work items (the tangible "working instance").
    if (plan.template) {
      const body = (req.body ?? {}) as { name?: unknown; programmeId?: unknown };
      const instPlan = planInstantiation(plan.template, {
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.programmeId === "string" ? { programmeId: body.programmeId } : {}),
      });
      const broker = getBroker();
      const ctx = contextFromReq(req);
      const project = await broker.createProject(ctx, { ...instPlan.project, omniInstanceId: randomUUID() });
      let seeded = 0;
      for (const issue of instPlan.seedIssues) {
        const created = await broker.writeIssue(ctx, "create", { projectId: project.id, ...issue } as unknown as IssueWrite);
        if (created?.id) seeded++;
      }
      applied.project = { id: project.id, seeded };
    }

    recordRequestAudit(req, {
      category: "admin", action: "preset_apply", result: "success", status: 201,
      meta: { presetId: plan.preset.id, methodology: plan.preset.methodology, ruleset: applied.referenceRuleset ?? null, projectId: applied.project?.id ?? null, seeded: applied.project?.seeded ?? 0 },
    });
    res.status(201).json({ presetId: plan.preset.id, methodology: plan.preset.methodology, applied, followUps: plan.followUps });
  });
});

export default router;
