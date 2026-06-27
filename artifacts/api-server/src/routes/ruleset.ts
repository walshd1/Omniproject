import { Router } from "express";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSession } from "./auth";
import { rulesetCatalogue, setRuleModes } from "../lib/ruleset";
import { recordAudit } from "../lib/audit";

/**
 * Admin-only business ruleset config. GET lists the rules + their current mode;
 * PUT sets modes (hard | warn | off). These are EXTRA rules layered on the hard
 * ruleset — see lib/ruleset.ts: they can only tighten, never loosen, and admin can
 * only toggle modes (not author predicates).
 */
const router = Router();

router.get("/admin/ruleset", requireRole("admin"), (_req, res) => {
  res.json(rulesetCatalogue());
});

router.put("/admin/ruleset", requireRole("admin"), (req, res) => {
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

export default router;
