import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";

/**
 * Metadata overrides for the built-in (catalogue) reports. Presentation-only: a per-report-id override of
 * label / order / visibility, merged over the shipped catalogue on the client so a customer can rename,
 * reorder or hide a built-in report without a rebuild. Never changes rendering (that's code) or data.
 * Any authenticated user may READ (so the overrides apply for everyone); authoring is PMO-gated, since it
 * is shared org config. Validated in updateSettings.
 */
const router = Router();

router.get("/reports/overrides", (_req, res) => {
  res.json({ reportOverrides: getSettings().reportOverrides ?? [] });
});

router.put("/reports/overrides", requireRole("pmo"), (req, res) => {
  const reportOverrides = (req.body as { reportOverrides?: unknown })?.reportOverrides;
  try {
    const settings = updateSettings({ reportOverrides });
    captureVersion("report overrides updated");
    res.json({ reportOverrides: settings.reportOverrides });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
