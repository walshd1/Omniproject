import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { resolveMethodologyComposition, writeOrgConfigCollection, METHODOLOGY_COMPOSITION_ID } from "../lib/scoped-config";

/**
 * The methodology COMPOSITION — the PMO/admin's curated set of visible artifact/output/ruleset ids, or `null`
 * (uncurated: everything the catalogues offer stays visible). Held in the composition model as a config-def-
 * backed collection whose value is NULLABLE (`null` is meaningful, so it can't ride the array-collection seam
 * whose default is `[]`). It gates the output surfaces (lib/composition-gate), reference rulesets and reports.
 *
 *  - GET /api/methodology-composition — the current composition (any authed user; the SPA composer reads it).
 *  - PUT /api/methodology-composition — set it (admin/PMO). Body: `{ methodologyComposition: string[] | null }`.
 */
const router = Router();

/** Validate the composition: `null` (uncurated) or an array of string ids. Throws on anything else. */
function sanitize(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new Error("methodologyComposition must be null or an array of strings");
  }
  return value as string[];
}

router.get("/methodology-composition", (_req, res) => {
  res.json({ methodologyComposition: resolveMethodologyComposition() });
});

router.put("/methodology-composition", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  let value: string[] | null;
  try { value = sanitize((req.body as { methodologyComposition?: unknown } | undefined)?.methodologyComposition); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid methodology composition" }); return; }
  writeOrgConfigCollection(METHODOLOGY_COMPOSITION_ID, "Methodology composition", value);
  res.json({ methodologyComposition: resolveMethodologyComposition() });
});

export default router;
