import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";

/**
 * Bespoke report definitions (the report generator). Customer-level presentation config — a report is a
 * data-driven definition (filter + group-by + aggregated metrics + viz), never project data, and rides
 * the snapshot/export bundle. Any authenticated user may READ them (so saved reports render for everyone);
 * authoring is PMO-gated, since a custom report is shared org config. Validated in updateSettings.
 */
const router = Router();

router.get("/reports/custom", (_req, res) => {
  res.json({ customReports: getSettings().customReports ?? [] });
});

router.put("/reports/custom", requireRole("pmo"), (req, res) => {
  const customReports = (req.body as { customReports?: unknown })?.customReports;
  try {
    const settings = updateSettings({ customReports });
    captureVersion("custom reports updated");
    res.json({ customReports: settings.customReports });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
