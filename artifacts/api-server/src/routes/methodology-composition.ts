import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { resolveMethodologyComposition, writeOrgConfigCollection, METHODOLOGY_COMPOSITION_ID } from "../lib/scoped-config";
import { resolveMethodologyDeployment } from "@workspace/backend-catalogue";
import { applyRuleset } from "../lib/ruleset";
import { recordRequestAudit } from "../lib/audit";

/**
 * The methodology COMPOSITION — the PMO/admin's curated set of visible artifact/output/ruleset ids, or `null`
 * (uncurated: everything the catalogues offer stays visible). Held in the composition model as a config-def-
 * backed collection whose value is NULLABLE (`null` is meaningful, so it can't ride the array-collection seam
 * whose default is `[]`). It gates the output surfaces (lib/composition-gate), reference rulesets and reports.
 *
 *  - GET /api/methodology-composition — the current composition (any authed user; the SPA composer reads it).
 *  - PUT /api/methodology-composition — set it (admin/PMO). Body: `{ methodologyComposition: string[] | null }`.
 *  - GET /api/methodology-composition/deployment/:id — PREVIEW a one-click methodology deploy (any authed):
 *      the composition item ids it turns on + its ruleset + its business-rule invariants.
 *  - POST /api/methodology-composition/deploy/:id — DEPLOY a methodology in one click (admin/PMO): set the
 *      org composition to its tagged surfaces AND apply its reference ruleset, atomically. (Programme/project
 *      scope is the remaining wiring; today the composition is org-scoped.)
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

// PREVIEW: what deploying this methodology would turn on (read-only, any authed user).
router.get("/methodology-composition/deployment/:id", (req, res) => {
  const plan = resolveMethodologyDeployment(String((req.params as { id?: unknown }).id ?? ""));
  if (!plan) { res.status(404).json({ error: "unknown methodology" }); return; }
  res.json(plan);
});

// DEPLOY: set the org composition to the methodology's tagged surfaces + apply its reference ruleset.
router.post("/methodology-composition/deploy/:id", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  const id = String((req.params as { id?: unknown }).id ?? "");
  const plan = resolveMethodologyDeployment(id);
  if (!plan) { res.status(404).json({ error: "unknown methodology" }); return; }
  // 1) Turn on the methodology's surfaces (its tagged composition item ids).
  writeOrgConfigCollection(METHODOLOGY_COMPOSITION_ID, "Methodology composition", plan.compositionItemIds);
  // 2) Apply its reference ruleset (modes + field rules), if it ships one.
  if (plan.ruleset) applyRuleset({ modes: plan.ruleset.modes, fieldRules: plan.ruleset.fieldRules });
  recordRequestAudit(req, {
    category: "admin", action: "methodology_deploy", result: "success", status: 200,
    meta: { methodology: id, items: plan.compositionItemIds.length, ruleset: plan.ruleset?.id ?? null, invariants: plan.invariants.length },
  });
  res.json({
    methodologyId: id,
    methodologyComposition: resolveMethodologyComposition(),
    appliedRuleset: plan.ruleset?.id ?? null,
    invariants: plan.invariants,
  });
});

export default router;
