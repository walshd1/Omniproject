import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";

/**
 * Saved views — named filter/sort/column/grouping presets a user can switch between. They are
 * SHARED, customer-level presentation config (they ride the config-bundle snapshot/export), so any
 * authenticated user may read and save them — like a team's shared filters. Benign presentation
 * config, never project data; admin-only `PATCH /settings` is not required.
 */
const router = Router();

router.get("/views", (_req, res) => {
  res.json({ views: getSettings().savedViews ?? [] });
});

router.put("/views", (req, res) => {
  const views = (req.body as { views?: unknown })?.views;
  try {
    const settings = updateSettings({ savedViews: views });
    captureVersion("saved views updated");
    res.json({ views: settings.savedViews });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
