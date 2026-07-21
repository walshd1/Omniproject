import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { CANONICAL_PRIORITY } from "../broker/vocabulary";
import { makeScopedId, requireArtifactStore } from "../lib/artifact-store";
import { getDef, putDef, type StoredDef } from "../lib/def-import";
import { configDefLayers, resolveScopedConfig } from "../lib/scoped-config";
import { contextFromReq } from "../broker";

/**
 * Custom display names for the canonical priority levels. Admin/PMO can relabel them (e.g. urgent →
 * "P0", high → "Critical"); an empty map means the canonical names. Kept separate from the premium
 * company-nomenclature labels so it's available without that entitlement — a basic governance knob.
 *
 * Held in the composition model as a scope-layered `priority-labels` config def (NOT a settings key): the map
 * folds system < org < programme < project, so a project could relabel further. Singleton org row → stable id.
 * The route contract (`GET`/`PUT /api/priority-labels` → `{ canonical, labels }`) is unchanged.
 */
const router = Router();

const PRIORITY_LABELS_CONFIG_ID = "priority-labels";
const ORG_PRIORITY_LABELS_ID = makeScopedId("org", `config-${PRIORITY_LABELS_CONFIG_ID}`);

/** Validate + normalise a labels map: canonical keys only, string values trimmed, empty dropped (⇒ canonical
 *  name), capped at 40 chars. Throws {@link Error} on a non-canonical key or a non-string value. */
function sanitizePriorityLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) throw new Error("priorityLabels must be an object");
  const clean: Record<string, string> = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!(CANONICAL_PRIORITY as readonly string[]).includes(k)) throw new Error(`priorityLabels key "${k}" is not a canonical priority`);
    if (val === undefined || val === null || val === "") continue; // empty ⇒ use the canonical name
    if (typeof val !== "string") throw new Error(`priorityLabels["${k}"] must be a string`);
    const t = val.trim();
    if (t.length > 40) throw new Error(`priorityLabels["${k}"] is too long (max 40)`);
    if (t) clean[k] = t;
  }
  return clean;
}

/** The effective labels folded across scopes (system < org < programme < project). */
function resolveLabels(scopes: { programmeId?: string; projectId?: string } = {}): Record<string, string> {
  return resolveScopedConfig<Record<string, string>>({}, configDefLayers(PRIORITY_LABELS_CONFIG_ID, scopes));
}

// GET /api/priority-labels — the canonical levels + the resolved custom labels (any authed user, for display).
router.get("/priority-labels", (req, res) => {
  const q = req.query as Record<string, unknown>;
  const scopes: { programmeId?: string; projectId?: string } = {};
  if (typeof q["programmeId"] === "string" && q["programmeId"]) scopes.programmeId = q["programmeId"];
  if (typeof q["projectId"] === "string" && q["projectId"]) scopes.projectId = q["projectId"];
  res.json({ canonical: CANONICAL_PRIORITY, labels: resolveLabels(scopes) });
});

// PUT /api/priority-labels — set the org-scope custom labels (admin or PMO). Body: { labels: { high: "Critical", … } }.
router.put("/priority-labels", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  let labels: Record<string, string>;
  try { labels = sanitizePriorityLabels((req.body as { labels?: unknown })?.labels ?? {}); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid priority labels" }); return; }

  const payload = { id: PRIORITY_LABELS_CONFIG_ID, values: labels };
  const existing = getDef({ kind: "org" }, ORG_PRIORITY_LABELS_ID);
  const ctx = contextFromReq(req);
  const now = new Date().toISOString();
  const row: StoredDef = existing
    ? { ...existing, payload, updatedAt: now, rowVersion: (existing.rowVersion ?? 1) + 1 }
    : { id: ORG_PRIORITY_LABELS_ID, kind: "config", name: "Priority labels", payload, createdBy: ctx.email ?? ctx.name ?? ctx.sub ?? null, createdAt: now, updatedAt: now, rowVersion: 1 };
  putDef({ kind: "org" }, row);
  res.json({ canonical: CANONICAL_PRIORITY, labels });
});

export default router;
