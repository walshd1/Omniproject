import { Router } from "express";
import { randomUUID } from "node:crypto";
import { requireRole } from "../lib/rbac";
import { getBroker, contextFromReq } from "../broker";
import type { IssueWrite } from "../broker/types";
import { readConfigCollection } from "../lib/scoped-config";
import { planInstantiation } from "../lib/project-template";
import { applyRuleset } from "../lib/ruleset";
import { planPresetApply, PresetError } from "../lib/preset-apply";
import { resolvePresets, resolvePreset } from "../lib/preset-config";
import { type ProjectTemplate } from "@workspace/backend-catalogue";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

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

// GET /api/presets — the quick-load presets, resolved from system JSON + org overrides (copy-and-override).
router.get("/presets", requireRole("viewer"), (_req, res) => {
  res.json(resolvePresets());
});

// GET /api/presets/:id — one resolved preset.
router.get("/presets/:id", requireRole("viewer"), (req, res) => {
  const preset = resolvePreset(String((req.params as { id?: unknown }).id ?? ""));
  if (!preset) { res.status(404).json({ error: "Preset not found" }); return; }
  res.json(preset);
});

/**
 * POST /api/presets/:id/apply — apply the preset (pmo). Body: { name?, programmeId? } for the starter project.
 *
 * LANE 2 (broker-aware): the preset resolution + plan (which throws PresetError → 4xx for an unknown preset)
 * is the parse gate; the effect — apply the reference ruleset, instantiate the starter project via the broker,
 * seed its issues — is `run`, marked `broker: true` so the action base wraps it in withBrokerErrors (a broker
 * failure maps to its status and records NO success audit). The existing `preset_apply` audit moves verbatim
 * to auditMeta/auditStatus (201). Response (presetId + methodology + applied + followUps) unchanged.
 */
export const presetApplyCommand: CommandDescriptor<{ plan: ReturnType<typeof planPresetApply>; body: unknown }> = {
  name: "preset_apply",
  method: "post",
  path: "/presets/:id/apply",
  role: "pmo",
  parse: (req, res) => {
    try {
      const preset = resolvePreset(String((req.params as { id?: unknown }).id ?? ""));
      return { plan: planPresetApply(preset, readConfigCollection<ProjectTemplate[]>("templates", [])), body: req.body };
    } catch (e) {
      if (e instanceof PresetError) { res.status(e.status).json({ error: e.message }); return null; }
      throw e;
    }
  },
  broker: { message: "apply preset failed" },
  run: async (req, _res, { plan, body }) => {
    const applied: { referenceRuleset?: string; project?: { id: string; seeded: number } } = {};

    // 1) Apply the reference ruleset (field/mode rules for the methodology).
    if (plan.rulesetBundle) {
      applyRuleset({ modes: plan.rulesetBundle.modes, fieldRules: plan.rulesetBundle.fieldRules });
      if (plan.preset.referenceRuleset) applied.referenceRuleset = plan.preset.referenceRuleset;
    }

    // 2) Instantiate the starter project + seed its work items (the tangible "working instance").
    if (plan.template) {
      const b = (body ?? {}) as { name?: unknown; programmeId?: unknown };
      const instPlan = planInstantiation(plan.template, {
        ...(typeof b.name === "string" ? { name: b.name } : {}),
        ...(typeof b.programmeId === "string" ? { programmeId: b.programmeId } : {}),
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

    return { presetId: plan.preset.id, methodology: plan.preset.methodology, applied, followUps: plan.followUps };
  },
  status: 201,
  audit: "preset_apply",
  auditCategory: "admin",
  auditStatus: 201,
  auditMeta: (_req, { plan }, result) => {
    const applied = (result as { applied: { referenceRuleset?: string; project?: { id: string; seeded: number } } }).applied;
    return {
      presetId: plan.preset.id, methodology: plan.preset.methodology,
      ruleset: applied.referenceRuleset ?? null, projectId: applied.project?.id ?? null, seeded: applied.project?.seeded ?? 0,
    };
  },
};
mountCommand(router, presetApplyCommand);

export default router;
