import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { getDef, putDef, type StoredDef } from "../lib/def-import";
import { contextFromReq } from "../broker";
import type { ConfigScopes } from "../lib/scoped-config";
import {
  TASK_VOCABULARY_CONFIG_ID,
  ORG_TASK_VOCABULARY_ID,
  resolveTaskVocabulary,
  sanitizeTaskVocabularyOverride,
} from "../lib/task-vocabulary-config";

/**
 * Scope-overridable GTD task-status vocabulary (next-actions axis, distinct from the work-item/issue status
 * axis). The canonical set is the shipped default seeded at system scope; org/programme/project/user layers
 * relabel, reorder, ADD, REMOVE and methodology-tag it (each status bound to a GTD workflow class — see
 * task-vocabulary-config). Contract: `GET /api/task-vocabulary` → the resolved `{ statuses }` for the caller's
 * scope (any authed user, for display + the task write-path membership check); `PUT` sets the org-scope
 * override (admin/PMO).
 */
const router = Router();

/** Read the request's resolution scopes: programme/project from the query, user from the auth context. */
function scopesFromReq(req: Parameters<typeof contextFromReq>[0]): ConfigScopes {
  const q = (req as { query?: Record<string, unknown> }).query ?? {};
  const scopes: ConfigScopes = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  const sub = contextFromReq(req).sub;
  if (sub) scopes.sub = sub;
  return scopes;
}

// GET /api/task-vocabulary — the effective GTD task statuses for this scope (any authed user).
router.get("/task-vocabulary", (req, res) => {
  res.json(resolveTaskVocabulary(scopesFromReq(req)));
});

// PUT /api/task-vocabulary — set the ORG-scope relabel/reorder/add/remove override (admin or PMO). Body:
// { statuses?: [{ id, label?, order?, class?, methodologies?, color?, labels?, removed? }] }.
router.put("/task-vocabulary", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  let values: { statuses: unknown[] };
  try {
    values = sanitizeTaskVocabularyOverride(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid task vocabulary override" });
    return;
  }
  const payload = { id: TASK_VOCABULARY_CONFIG_ID, values };
  const existing = getDef({ kind: "org" }, ORG_TASK_VOCABULARY_ID);
  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_TASK_VOCABULARY_ID, kind: "config", name: "Task vocabulary", payload, createdBy: ctx.email ?? ctx.name ?? ctx.sub ?? null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  // Return the newly-resolved vocabulary for this caller's scope so the client can update in place.
  res.json(resolveTaskVocabulary(scopesFromReq(req)));
});

export default router;
