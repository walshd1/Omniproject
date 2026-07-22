import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { getDef, putDef, type StoredDef } from "../lib/def-import";
import { contextFromReq } from "../broker";
import type { ConfigScopes } from "../lib/scoped-config";
import {
  LIKELIHOOD_VOCABULARY_CONFIG_ID,
  ORG_LIKELIHOOD_VOCABULARY_ID,
  resolveLikelihoodVocabulary,
  sanitizeLikelihoodVocabularyOverride,
} from "../lib/likelihood-vocabulary-config";

/**
 * Scope-overridable RAID/risk LIKELIHOOD vocabulary (the probability a risk occurs — the P in risk-exposure
 * P×I). The canonical set is the shipped default seeded at system scope; org/programme/project/user layers
 * relabel, reorder, ADD, REMOVE and methodology-tag it (each grade bound to an internal ordinal level — see
 * likelihood-vocabulary-config). Contract: `GET /api/likelihood-vocabulary` → the resolved `{ levels }` for
 * the caller's scope (any authed user, for display + the RAID write-path membership check); `PUT` sets the
 * org-scope override (admin/PMO).
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

// GET /api/likelihood-vocabulary — the effective RAID likelihood grades for this scope (any authed user).
router.get("/likelihood-vocabulary", (req, res) => {
  res.json(resolveLikelihoodVocabulary(scopesFromReq(req)));
});

// PUT /api/likelihood-vocabulary — set the ORG-scope relabel/reorder/add/remove override (admin or PMO). Body:
// { levels?: [{ id, label?, order?, level?, methodologies?, color?, labels?, removed? }] }.
router.put("/likelihood-vocabulary", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  let values: { levels: unknown[] };
  try {
    values = sanitizeLikelihoodVocabularyOverride(req.body ?? {});
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "invalid likelihood vocabulary override" });
    return;
  }
  const payload = { id: LIKELIHOOD_VOCABULARY_CONFIG_ID, values };
  const existing = getDef({ kind: "org" }, ORG_LIKELIHOOD_VOCABULARY_ID);
  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_LIKELIHOOD_VOCABULARY_ID, kind: "config", name: "Likelihood vocabulary", payload, createdBy: ctx.email ?? ctx.name ?? ctx.sub ?? null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  // Return the newly-resolved vocabulary for this caller's scope so the client can update in place.
  res.json(resolveLikelihoodVocabulary(scopesFromReq(req)));
});

export default router;
