import { Router } from "express";
import { entryRequirements } from "../lib/ruleset";

/**
 * Read-only view of the EFFECTIVE business-rule field requirements for entry, so the SPA can push back
 * inline BEFORE a create (e.g. "a priority is required") instead of only discovering it via a 422 on
 * submit. Mounted behind requireAuth/viewer, so any authenticated session may read it — but it exposes
 * only WHICH fields are required for the caller's scope, never the authoring surface (that stays
 * PMO-gated at /admin/ruleset). The server still enforces the FULL ruleset authoritatively on every
 * write; this endpoint is purely a courtesy so the client can guide the user gently up front.
 */
const router = Router();

// GET /api/rules/active(?projectId=&programmeId=) — the effective field requirements for entry in the
// given scope (org baseline, tightened by any programme/project override).
router.get("/rules/active", (req, res) => {
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : null;
  const programmeId = typeof req.query["programmeId"] === "string" ? req.query["programmeId"] : null;
  res.json({ requirements: entryRequirements({ projectId, programmeId }) });
});

export default router;
