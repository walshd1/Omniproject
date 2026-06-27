import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { rulesetCatalogue, setRuleModes, getFieldRules, setFieldRules } from "../lib/ruleset";
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

export default router;
