import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { rulesetCatalogue, setRuleModes, getFieldRules, setFieldRules, applyRuleset } from "../lib/ruleset";
import { referenceRulesetCatalogue, getReferenceRuleset } from "@workspace/backend-catalogue";
import { recordAudit, actorForAudit } from "../lib/audit";
import { getSettings } from "../lib/settings";
import { v, parseOr400 } from "../lib/validate";

/** Whether a methodology's reference ruleset is enabled by the methodology composition. The composition
 *  stores enabled item ids as `ruleset:<methodology>`; `null` = uncurated (everything enabled). */
function rulesetInComposition(methodology: string): boolean {
  const composition = getSettings().methodologyComposition;
  return composition === null || composition.includes(`ruleset:${methodology}`);
}

// `methodology` is an untrusted id used to look up a curated bundle — type + bound it.
const APPLY_REFERENCE_BODY = v.object({ methodology: v.string({ trim: true, min: 1, max: 100 }) });

/**
 * Business ruleset config — PMO governance. GET lists the rules + their current
 * mode; PUT sets modes (hard | warn | off). These are EXTRA rules layered on the
 * hard ruleset — see lib/ruleset.ts: they can only tighten, never loosen, and the
 * PMO can only toggle modes (not author predicates).
 *
 * Gated at the `pmo` authority: the business/programme ruleset is the PMO's domain.
 * `pmo` and `admin` are ORTHOGONAL — technical config (brokers, integrations,
 * security) stays admin-only, and a pure admin does NOT pass here. Someone holding
 * both authorities clears both.
 */
const router = Router();

router.get("/admin/ruleset", requireRole("pmo"), (_req, res) => {
  res.json(rulesetCatalogue());
});

router.put("/admin/ruleset", requireRole("pmo"), (req, res) => {
  const modes = setRuleModes((req.body ?? {}) as Record<string, unknown>);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "ruleset_update",
    actor: actorForAudit(req),
    result: "success",
    status: 200,
    meta: { modes },
  });
  res.json(rulesetCatalogue());
});

// Admin field rules — "what must go in fields" + dependencies. PUT replaces the
// whole set. These can only REQUIRE a field (restrict-only); they never grant.
router.get("/admin/ruleset/fields", requireRole("pmo"), (_req, res) => {
  res.json(getFieldRules());
});
router.put("/admin/ruleset/fields", requireRole("pmo"), (req, res) => {
  const rules = setFieldRules(req.body);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "ruleset_fields_update",
    actor: actorForAudit(req),
    result: "success",
    status: 200,
    meta: { count: rules.length },
  });
  res.json(rules);
});

// ── Reference rulesets — curated, named bundles per methodology ───────────────
// List the reference rulesets (compliance/completeness baselines) a PMO can apply — filtered to the ones
// the methodology composition enables (uncurated ⇒ all).
router.get("/admin/ruleset/reference", requireRole("pmo"), (_req, res) => {
  res.json(referenceRulesetCatalogue().filter((r) => rulesetInComposition(r.id)));
});

// Apply one reference ruleset by methodology id. Deterministic + restrict-only
// (routes through applyRuleset → setRuleModes/setFieldRules). Audited.
router.post("/admin/ruleset/apply-reference", requireRole("pmo"), (req, res) => {
  const parsed = parseOr400(req, res, APPLY_REFERENCE_BODY);
  if (!parsed) return;
  const methodology = parsed.methodology;
  const bundle = getReferenceRuleset(methodology);
  if (!bundle) {
    res.status(404).json({ error: `No reference ruleset for methodology '${methodology}'` });
    return;
  }
  // The methodology composition can curate this ruleset out — don't let it be applied when it's disabled.
  if (!rulesetInComposition(methodology)) {
    res.status(403).json({ error: `Reference ruleset '${methodology}' is disabled by the methodology composition` });
    return;
  }
  const applied = applyRuleset({ modes: bundle.modes, fieldRules: bundle.fieldRules });
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "ruleset_apply_reference",
    actor: actorForAudit(req),
    result: "success",
    status: 200,
    meta: { methodology, modes: applied.modes, fieldRuleCount: applied.fieldRules.length },
  });
  res.json({ methodology, ...rulesetCatalogueWithFields() });
});

function rulesetCatalogueWithFields() {
  return { rules: rulesetCatalogue(), fieldRules: getFieldRules() };
}

export default router;
