import { Router } from "express";
import { normalisedBy } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { readConfigCollection } from "../lib/scoped-config";
import { requireAnyRole } from "../lib/rbac";
import { getBroker, contextFromReq } from "../broker";
import type { IssueWrite } from "../broker/types";
import { planInstantiation, validateTemplates, TemplateError } from "../lib/project-template";
import { resolveProjectTemplate, type ProjectTemplate } from "@workspace/backend-catalogue";
import { randomUUID } from "node:crypto";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * Project TEMPLATES — the "spin up a project from a template" gallery. The definitions store (GET open, PUT
 * admin/PMO) plus an INSTANTIATE endpoint that creates the project and seeds its work items through the
 * broker — the same RBAC-scoped write path as the project grid (project create is manager+). Nothing is
 * stored here beyond the definitions; the instantiated project lives in the system of record.
 */
const router = Router();

/**
 * POST /api/templates/:id/instantiate — instantiate a template: create a project + seed its work items.
 * Manager+ (creating a project).
 *
 * LANE 2 (broker-aware): parse resolves the template from the shipped catalogue merged with the org's
 * overrides (404 if unknown) and plans the instantiation; the `create_project` business ruleset runs by
 * construction against the planned project (ruleScope), before any broker call; the effect — create the
 * project + seed its issues through the broker — is `run`, marked `broker: true` so a broker failure maps to
 * its status and records NO success audit. The action base now records a success audit (template_instantiate)
 * the hand-written route lacked — additive, no-op under default config. Response (project + seeded count) and
 * the 201 status are unchanged.
 */
export const templateInstantiateCommand: CommandDescriptor<{ id: string; plan: ReturnType<typeof planInstantiation>; body: { name?: unknown; programmeId?: unknown } }> = {
  name: "template_instantiate",
  method: "post",
  path: "/templates/:id/instantiate",
  role: "manager",
  parse: (req, res) => {
    const id = String((req.params as { id?: unknown }).id ?? "");
    // Resolve from the shipped catalogue merged with the org's overrides (default JSON + org override), so a
    // built-in template is instantiable directly and an org customisation of the same id wins.
    const template = resolveProjectTemplate(id, readConfigCollection<ProjectTemplate[]>("templates", []));
    if (!template) { res.status(404).json({ error: "Template not found" }); return null; }
    const body = (req.body ?? {}) as { name?: unknown; programmeId?: unknown };
    const plan = planInstantiation(template, {
      ...(typeof body.name === "string" ? { name: body.name } : {}),
      ...(typeof body.programmeId === "string" ? { programmeId: body.programmeId } : {}),
    });
    return { id, plan, body };
  },
  ruleAction: "create_project",
  ruleScope: (_req, { plan, body }) => ({
    programmeId: typeof body.programmeId === "string" ? body.programmeId : null,
    payload: plan.project as unknown as Record<string, unknown>,
  }),
  broker: { message: "instantiate template failed" },
  run: async (req, _res, { plan }) => {
    const broker = getBroker();
    const ctx = contextFromReq(req);
    const project = await broker.createProject(ctx, { ...plan.project, omniInstanceId: randomUUID() });
    const seeded: string[] = [];
    for (const issue of plan.seedIssues) {
      const created = await broker.writeIssue(ctx, "create", { projectId: project.id, ...issue } as unknown as IssueWrite);
      if (created?.id) seeded.push(created.id);
    }
    return { project, seeded: seeded.length };
  },
  status: 201,
  audit: "template_instantiate",
  auditMeta: (_req, { id }, result) => {
    const r = result as { project: { id: string }; seeded: number };
    return { templateId: id, projectId: r.project.id, seeded: r.seeded };
  },
};
mountCommand(router, templateInstantiateCommand);

// The template definitions store — read open (the SPA lists them), write gated to admin/PMO.
router.use(settingsCollectionRouter({
  path: "/templates",
  responseKey: "templates",
  configId: "templates", // config-def-backed (CHOICE) — no longer a settings key
  validate: normalisedBy((v) => validateTemplates(v), TemplateError),
  versionLabel: "templates updated",
  writeGuards: [requireAnyRole("admin", "pmo")],
}));

export default router;
