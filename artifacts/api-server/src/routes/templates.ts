import { Router } from "express";
import { normalisedBy } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { readConfigCollection } from "../lib/scoped-config";
import { requireAnyRole, requireRole } from "../lib/rbac";
import { enforceBusinessRules } from "../lib/ruleset-guard";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import type { IssueWrite } from "../broker/types";
import { planInstantiation, validateTemplates, TemplateError } from "../lib/project-template";
import { resolveProjectTemplate, type ProjectTemplate } from "@workspace/backend-catalogue";
import { randomUUID } from "node:crypto";

/**
 * Project TEMPLATES — the "spin up a project from a template" gallery. The definitions store (GET open, PUT
 * admin/PMO) plus an INSTANTIATE endpoint that creates the project and seeds its work items through the
 * broker — the same RBAC-scoped write path as the project grid (project create is manager+). Nothing is
 * stored here beyond the definitions; the instantiated project lives in the system of record.
 */
const router = Router();

/** Instantiate a template: create a project + seed its work items. Manager+ (creating a project). */
router.post("/templates/:id/instantiate", requireRole("manager"), async (req, res) => {
  const id = String((req.params as { id?: unknown }).id ?? "");
  // Resolve from the shipped catalogue merged with the org's overrides (default JSON + org override), so a
  // built-in template is instantiable directly and an org customisation of the same id wins.
  const template = resolveProjectTemplate(id, readConfigCollection<ProjectTemplate[]>("templates", []));
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const body = (req.body ?? {}) as { name?: unknown; programmeId?: unknown };
  const plan = planInstantiation(template, {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.programmeId === "string" ? { programmeId: body.programmeId } : {}),
  });

  await withBrokerErrors(req, res, "instantiate template failed", async () => {
    const broker = getBroker();
    const ctx = contextFromReq(req);
    if (!enforceBusinessRules(req, res, "create_project", { programmeId: typeof body.programmeId === "string" ? body.programmeId : null, payload: plan.project as unknown as Record<string, unknown> })) return;
    const project = await broker.createProject(ctx, { ...plan.project, omniInstanceId: randomUUID() });
    const seeded: string[] = [];
    for (const issue of plan.seedIssues) {
      const created = await broker.writeIssue(ctx, "create", { projectId: project.id, ...issue } as unknown as IssueWrite);
      if (created?.id) seeded.push(created.id);
    }
    res.status(201).json({ project, seeded: seeded.length });
  });
});

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
