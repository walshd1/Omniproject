import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";

/**
 * Custom dashboards — named, ordered collections of widget instances a user composes from the
 * widget catalogue. Like saved views, these are SHARED, customer-level presentation config (they
 * ride the config-bundle snapshot/export), so any authenticated user may read and save them.
 * Benign presentation config, never project data; admin-only `PATCH /settings` is not required.
 */
const router = Router();

router.get("/dashboards", (_req, res) => {
  res.json({ dashboards: getSettings().dashboards ?? [] });
});

router.put("/dashboards", (req, res) => {
  const dashboards = (req.body as { dashboards?: unknown })?.dashboards;
  try {
    const settings = updateSettings({ dashboards });
    captureVersion("dashboards updated");
    res.json({ dashboards: settings.dashboards });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
