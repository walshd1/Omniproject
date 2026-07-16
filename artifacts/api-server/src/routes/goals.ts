import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import {
  artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact,
} from "../lib/artifact-store";
import {
  GOAL_ARTIFACT, sanitizeGoalWrite, makeGoalId, parseGoalId, goalScope,
  newGoalRow, mergeGoalRow, goalMeta, GoalError, type Goal, type GoalMeta, type GoalStorage,
} from "../lib/goal";

/**
 * GOALS / OKRs (roadmap 3.2). A goal is a first-class OBJECTIVE with measurable KEY RESULTS; its progress is
 * derived server-side from key-result attainment. Saved to a STORAGE TARGET the author chooses — their
 * PRIVATE / a PROJECT's / the ORG-wide encrypted-JSON area (AES-256-GCM sealed at rest) — the same
 * storage-target pattern as proofs/whiteboards/wiki (no sidecar; a goal is always OmniProject-held). Ids are
 * self-describing (`<target>~…`) so a read routes to the right store; a `user` scope always uses the caller's
 * own sub. Every write passes the one sanitising choke point (`sanitizeGoalWrite`). RBAC: read viewer+,
 * author contributor+, delete contributor+, org writes/deletes additionally manager+ (the storage-target gate).
 */
const router = Router();

/** Per-target authorization for one goal operation (the shared storage-target gate; goals have no sidecar). */
const authorizeTarget = (
  req: Parameters<typeof authorizeStorageTarget>[0], res: Parameters<typeof authorizeStorageTarget>[1],
  storage: GoalStorage, projectId: string | undefined, op: "read" | "write",
): Promise<boolean> =>
  authorizeStorageTarget(req, res, storage, projectId, op, { capability: false, capabilityError: "goals are not stored in the sidecar" });

// GET /api/goals?projectId= — goals (key results omitted) across every accessible store (viewer+).
router.get("/goals", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "list_goals failed", async () => {
    if (!artifactStoreEnabled()) { res.json([]); return; }
    const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
    const ctx = contextFromReq(req);
    const metas: GoalMeta[] = [];
    if (ctx.sub) for (const g of listArtifacts<Goal>(GOAL_ARTIFACT, { kind: "user", sub: ctx.sub })) metas.push(goalMeta(g));
    for (const g of listArtifacts<Goal>(GOAL_ARTIFACT, { kind: "org" })) metas.push(goalMeta(g));
    if (projectId && (await assertProjectScope(req, projectId)).ok) {
      for (const g of listArtifacts<Goal>(GOAL_ARTIFACT, { kind: "project", projectId })) metas.push(goalMeta(g));
    }
    res.json(metas);
  }),
);

// GET /api/goals/:id — one goal with its key results (viewer+).
router.get("/goals/:id", requireRole("viewer"), (req, res) =>
  withBrokerErrors(req, res, "get_goal failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseGoalId(id);
    if (!parsed || !artifactStoreEnabled()) { res.status(404).json({ error: "Goal not found" }); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "read"))) return;
    const scope = goalScope(parsed, contextFromReq(req).sub);
    const goal = scope ? getArtifact<Goal>(GOAL_ARTIFACT, scope, id) : null;
    if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
    res.json(goal);
  }),
);

// POST /api/goals — create a goal in the chosen storage target (contributor+).
router.post("/goals", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeGoalWrite(req.body); }
  catch (e) { if (e instanceof GoalError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "create_goal failed", async () => {
    if (!(await authorizeTarget(req, res, input.storage, input.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
    const ctx = contextFromReq(req);
    const scope = goalScope(input, ctx.sub);
    if (!scope) { res.status(400).json({ error: "invalid storage target" }); return; }
    const id = makeGoalId(input.storage, crypto.randomUUID(), input.projectId);
    const row = newGoalRow(id, input, ctx, new Date().toISOString());
    putArtifact(GOAL_ARTIFACT, scope, row);
    res.status(201).json(row);
  });
});

// PUT /api/goals/:id — update a goal in place (contributor+); progress is recomputed from the key results.
router.put("/goals/:id", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeGoalWrite(req.body); }
  catch (e) { if (e instanceof GoalError) { res.status(400).json({ error: e.message }); return; } throw e; }
  const id = String(req.params["id"]);
  const parsed = parseGoalId(id);
  if (!parsed) { res.status(404).json({ error: "Goal not found" }); return; }
  return withBrokerErrors(req, res, "update_goal failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Goal not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = goalScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Goal>(GOAL_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Goal not found" }); return; }
    const row = mergeGoalRow(existing, input, ctx, new Date().toISOString());
    putArtifact(GOAL_ARTIFACT, scope, row);
    res.json(row);
  });
});

// DELETE /api/goals/:id — remove a goal (contributor+; an org goal additionally needs manager+).
router.delete("/goals/:id", requireRole("contributor"), (req, res) =>
  withBrokerErrors(req, res, "delete_goal failed", async () => {
    const id = String(req.params["id"]);
    const parsed = parseGoalId(id);
    if (!parsed) { res.status(204).end(); return; }
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(204).end(); return; }
    const scope = goalScope(parsed, contextFromReq(req).sub);
    if (scope) deleteArtifact(GOAL_ARTIFACT, scope, id);
    res.status(204).end();
  }),
);

export default router;
