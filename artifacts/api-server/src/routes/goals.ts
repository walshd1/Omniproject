import crypto from "node:crypto";
import { Router } from "express";
import { contextFromReq, withBrokerErrors } from "../broker";
import { requireRole } from "../lib/rbac";
import { assertProjectScope } from "../lib/project-scope";
import { authorizeStorageTarget } from "../lib/storage-target-authz";
import crypto2 from "node:crypto";
import { artifactStoreEnabled, listArtifacts, getArtifact, putArtifact, deleteArtifact, listAllArtifactCollections, requireArtifactStore } from "../lib/artifact-store";
import { getNotifyBus } from "../lib/notify-bus";
import { sharedKv } from "../lib/shared-state";
import {
  GOAL_ARTIFACT, sanitizeGoalWrite, sanitizeCheckInWrite, applyCheckIn,
  sanitizeGoalLink, addGoalLink, removeGoalLink, makeGoalId, parseGoalId, goalScope,
  newGoalRow, mergeGoalRow, goalMeta, runGoalCheckinSweep, GoalError,
  type Goal, type GoalMeta, type GoalStorage,
} from "../lib/goal";

/** Dedupe TTL for a fired check-in reminder — long enough that a period's nudge fires once. */
const CHECKIN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
    if (!requireArtifactStore(res)) return;
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

// POST /api/goals/:id/checkin — record a progress check-in: update key-result values, recompute progress,
// optionally set status + a note, and append a bounded history entry (contributor+; org goal ⇒ manager+).
router.post("/goals/:id/checkin", requireRole("contributor"), (req, res) => {
  let input;
  try { input = sanitizeCheckInWrite(req.body); }
  catch (e) { if (e instanceof GoalError) { res.status(400).json({ error: e.message }); return; } throw e; }
  const id = String(req.params["id"]);
  const parsed = parseGoalId(id);
  if (!parsed) { res.status(404).json({ error: "Goal not found" }); return; }
  return withBrokerErrors(req, res, "checkin_goal failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Goal not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = goalScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Goal>(GOAL_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Goal not found" }); return; }
    const row = applyCheckIn(existing, input, crypto.randomUUID(), ctx, new Date().toISOString());
    putArtifact(GOAL_ARTIFACT, scope, row);
    res.status(201).json(row);
  });
});

// POST /api/goals/:id/links — link a work item to the goal (reference-only, idempotent) (contributor+).
router.post("/goals/:id/links", requireRole("contributor"), (req, res) => {
  const id = String(req.params["id"]);
  const parsed = parseGoalId(id);
  if (!parsed) { res.status(404).json({ error: "Goal not found" }); return; }
  let link;
  try { link = sanitizeGoalLink(req.body, new Date().toISOString()); }
  catch (e) { if (e instanceof GoalError) { res.status(400).json({ error: e.message }); return; } throw e; }
  return withBrokerErrors(req, res, "link_goal failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Goal not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = goalScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Goal>(GOAL_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Goal not found" }); return; }
    let row;
    try { row = addGoalLink(existing, link, ctx, new Date().toISOString()); }
    catch (e) { if (e instanceof GoalError) { res.status(400).json({ error: e.message }); return; } throw e; }
    putArtifact(GOAL_ARTIFACT, scope, row);
    res.status(201).json(row);
  });
});

// DELETE /api/goals/:id/links/:key — unlink a work item by its link key (contributor+).
router.delete("/goals/:id/links/:key", requireRole("contributor"), (req, res) => {
  const id = String(req.params["id"]);
  const key = String(req.params["key"]);
  const parsed = parseGoalId(id);
  if (!parsed) { res.status(404).json({ error: "Goal not found" }); return; }
  return withBrokerErrors(req, res, "unlink_goal failed", async () => {
    if (!(await authorizeTarget(req, res, parsed.storage, parsed.projectId, "write"))) return;
    if (!artifactStoreEnabled()) { res.status(404).json({ error: "Goal not found" }); return; }
    const ctx = contextFromReq(req);
    const scope = goalScope(parsed, ctx.sub);
    const existing = scope ? getArtifact<Goal>(GOAL_ARTIFACT, scope, id) : null;
    if (!scope || !existing) { res.status(404).json({ error: "Goal not found" }); return; }
    const row = removeGoalLink(existing, key, ctx, new Date().toISOString());
    putArtifact(GOAL_ARTIFACT, scope, row);
    res.json(row);
  });
});

// POST /api/goals/checkins/sweep — deliver any DUE check-in reminders in-app (pmo+, cron/routine-driven).
// Nudges each goal whose `nextCheckInAt` has passed once (deduped via shared-state), notifying the owner,
// and rolls the cadence forward so it recurs. Portfolio-wide, so it needs a pmo/admin caller.
router.post("/goals/checkins/sweep", requireRole("pmo"), (req, res) =>
  withBrokerErrors(req, res, "goal check-in sweep failed", async () => {
    if (!artifactStoreEnabled()) { res.json({ nudged: 0, goalIds: [] }); return; }
    // Enumerate every goal across all scopes, remembering each one's scope so we can persist the roll-forward.
    const collections = listAllArtifactCollections<Goal>(GOAL_ARTIFACT);
    const scopeById = new Map<string, (typeof collections)[number]["scope"]>();
    const goals: Goal[] = [];
    for (const c of collections) for (const g of c.items) { goals.push(g); scopeById.set(g.id, c.scope); }
    const bus = getNotifyBus();
    const result = await runGoalCheckinSweep({
      goals,
      nowMs: Date.now(),
      nowISO: new Date().toISOString(),
      isFired: async (key) => !!(await sharedKv.get(key)),
      markFired: async (key) => { await sharedKv.set(key, "1", { ttlMs: CHECKIN_TTL_MS }); },
      notify: (n, target) => void bus.publish({
        notification: { id: `goal-${crypto2.randomUUID()}`, kind: n.kind, title: n.title, body: n.body, read: false, timestamp: Date.now() },
        ...(target.sub ? { target } : {}),
      }),
      reschedule: (goal) => { const scope = scopeById.get(goal.id); if (scope) putArtifact(GOAL_ARTIFACT, scope, goal); },
    });
    res.json(result);
  }),
);

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
