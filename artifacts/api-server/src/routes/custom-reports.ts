import { Router } from "express";
import { resolveCustomReports } from "../lib/report-store";

/**
 * Bespoke REPORT DEFINITIONS (roadmap X.10 — reports convergence). A custom report is a data-driven definition
 * (filter + group-by + aggregated metrics + viz), never project data. Report defs are authored through the ONE
 * importer (`POST`/`PUT /api/defs`, kind `report`) into the encrypted def store; the CustomReport renderer reads
 * them from `GET /reports/custom/resolved`. (Overrides of the shipped built-in reports remain the separate
 * `reportOverrides` settings overlay.)
 */
const router = Router();

// GET /api/reports/custom/resolved — the effective bespoke set (org/project/user def-store reports, nearest
// scope winning by id). The CustomReport renderer reads THIS.
router.get("/reports/custom/resolved", (req, res) => {
  res.json({ customReports: resolveCustomReports(req) });
});

export default router;
