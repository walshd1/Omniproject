import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { rulesetCatalogue, setRuleModes, getFieldRules, setFieldRules, applyRuleset } from "../lib/ruleset";
import { referenceRulesetCatalogue, getReferenceRuleset } from "@workspace/backend-catalogue";
import { recordAudit } from "../lib/audit";

/**
 * Business ruleset config — PMO governance. GET lists the rules + their current
 * mode; PUT sets modes (hard | warn | off). These are EXTRA rules layered on the
 * hard ruleset — see lib/ruleset.ts: they can only tighten, never loosen, and the
 * PMO can only toggle modes (not author predicates).
 *
 * Gated at `pmo`, not `admin`: the business/programme ruleset is the PMO's domain
 * (technical config — brokers, integrations, security — stays admin-only). Because
 * the role gate is linear, admin (top rank) is a superset and still passes here.
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
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
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
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
    result: "success",
    status: 200,
    meta: { count: rules.length },
  });
  res.json(rules);
});

// ── Reference rulesets — curated, named bundles per methodology ───────────────
// List the reference rulesets (compliance/completeness baselines) a PMO can apply.
router.get("/admin/ruleset/reference", requireRole("pmo"), (_req, res) => {
  res.json(referenceRulesetCatalogue());
});

// Apply one reference ruleset by methodology id. Deterministic + restrict-only
// (routes through applyRuleset → setRuleModes/setFieldRules). Audited.
router.post("/admin/ruleset/apply-reference", requireRole("pmo"), (req, res) => {
  const methodology = (req.body as { methodology?: unknown } | undefined)?.methodology;
  if (typeof methodology !== "string") {
    res.status(400).json({ error: "Body must be { methodology: string }" });
    return;
  }
  const bundle = getReferenceRuleset(methodology);
  if (!bundle) {
    res.status(404).json({ error: `No reference ruleset for methodology '${methodology}'` });
    return;
  }
  const applied = applyRuleset({ modes: bundle.modes, fieldRules: bundle.fieldRules });
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "ruleset_apply_reference",
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
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
