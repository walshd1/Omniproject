import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { getDef, putDef, type StoredDef } from "../lib/def-import";
import { contextFromReq } from "../broker";
import type { ConfigScopes } from "../lib/scoped-config";
import {
  WORK_VOCABULARY_CONFIG_ID,
  ORG_WORK_VOCABULARY_ID,
  resolveWorkVocabulary,
  sanitizeWorkVocabularyOverride,
} from "../lib/work-vocabulary-config";

/**
 * Scope-overridable work-item vocabulary (statuses + priorities). The canonical set is the shipped default
 * seeded at system scope; org/programme/project/user layers relabel + reorder it (never add/remove/reclassify
 * — see work-vocabulary-config). Contract: `GET /api/work-vocabulary` → the resolved `{ statuses, priorities }`
 * for the caller's scope (any authed user, for display); `PUT` sets the org-scope override (admin/PMO).
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

// GET /api/work-vocabulary — the effective statuses + priorities for this scope (any authed user).
router.get("/work-vocabulary", (req, res) => {
  res.json(resolveWorkVocabulary(scopesFromReq(req)));
});

// PUT /api/work-vocabulary — set the ORG-scope relabel/reorder override (admin or PMO). Body:
// { statuses?: [{ id, label?, order? }], priorities?: [{ id, label?, order? }] }.
router.put("/work-vocabulary", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  let values: { statuses: unknown[]; priorities: unknown[] };
  try {
    values = sanitizeWorkVocabularyOverride(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid work vocabulary override" });
    return;
  }
  const payload = { id: WORK_VOCABULARY_CONFIG_ID, values };
  const existing = getDef({ kind: "org" }, ORG_WORK_VOCABULARY_ID);
  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary", payload, createdBy: ctx.email ?? ctx.name ?? ctx.sub ?? null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  // Return the newly-resolved vocabulary for this caller's scope so the client can update in place.
  res.json(resolveWorkVocabulary(scopesFromReq(req)));
});

export default router;
