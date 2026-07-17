import { Router } from "express";
import { getSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { applySettingsGuarded } from "../lib/settings-guard";
import { actorForAudit } from "../lib/audit";
import { requireRole } from "../lib/rbac";
import { resolveCustomReports } from "../lib/report-store";

/**
 * Bespoke REPORT DEFINITIONS (roadmap X.10 — reports convergence). A custom report is a data-driven definition
 * (filter + group-by + aggregated metrics + viz), never project data. Report defs are now authored through the
 * importer (`POST`/`PUT /api/defs`, kind `report`) into the encrypted def store; the CustomReport renderer reads
 * them from `GET /reports/custom/resolved`. This legacy slice survives READ-ONLY, plus one permitted write:
 * **draining to `[]`** (the one-time migration in the report generator). A non-empty write is a retired bypass
 * → 410 Gone. (Overrides of the shipped built-in reports remain the separate `reportOverrides` settings overlay.)
 */
const router = Router();

router.get("/reports/custom", (_req, res) => {
  res.json({ customReports: getSettings().customReports ?? [] });
});

// GET /api/reports/custom/resolved — the effective bespoke set (legacy bridge + org/project/user def-store
// reports, def store winning). The CustomReport renderer reads THIS.
router.get("/reports/custom/resolved", (req, res) => {
  res.json({ customReports: resolveCustomReports(req) });
});

router.put("/reports/custom", requireRole("pmo"), async (req, res) => {
  const value = (req.body as Record<string, unknown> | undefined)?.["customReports"];
  if (!Array.isArray(value) || value.length > 0) {
    res.status(410).json({
      error: "Custom reports are now definitions — author them through the importer (POST /api/defs, kind \"report\"). The legacy settings store is read-only and accepts only an empty array to complete migration.",
    });
    return;
  }
  try {
    const guarded = await applySettingsGuarded({ customReports: [] }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, message: "This change needs a signed sign-off before it applies. See /api/approvals/inbox." });
      return;
    }
    captureVersion("custom reports drained (migrated to definitions)");
    res.json({ customReports: getSettings().customReports });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
