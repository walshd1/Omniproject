import { Router } from "express";
import { getSettings } from "../lib/settings";
import { settingsCollectionRouter } from "../lib/settings-collection-router";
import { requireAnyRole, requireRole } from "../lib/rbac";
import { getBroker, contextFromReq, withBrokerErrors } from "../broker";
import type { IssueWrite } from "../broker/types";
import { planInstantiation } from "../lib/project-template";
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
  const template = (getSettings().templates ?? []).find((t) => t.id === id);
  if (!template) { res.status(404).json({ error: "Template not found" }); return; }

  const body = (req.body ?? {}) as { name?: unknown; programmeId?: unknown };
  const plan = planInstantiation(template, {
    ...(typeof body.name === "string" ? { name: body.name } : {}),
    ...(typeof body.programmeId === "string" ? { programmeId: body.programmeId } : {}),
  });

  await withBrokerErrors(req, res, "instantiate template failed", async () => {
    const broker = getBroker();
    const ctx = contextFromReq(req);
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
  settingsKey: "templates",
  versionLabel: "templates updated",
  writeGuards: [requireAnyRole("admin", "pmo")],
}));

export default router;
