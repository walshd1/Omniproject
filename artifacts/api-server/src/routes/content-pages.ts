import { Router } from "express";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";
import { requireRole } from "../lib/rbac";

/**
 * Content pages — named, ordered lists of unified-library component ids (reports + widgets, see
 * @workspace/backend-catalogue componentsFor("content")) a customer composes into free-form content,
 * rendered through the generic content-page renderer. Customer-level presentation config — a page is a
 * list of ids, never project data — and rides the snapshot/export bundle. Any authenticated user may
 * READ them (so a saved page renders for everyone); authoring is PMO-gated, since a content page is
 * shared org config. Same persistence shape as routes/custom-reports. Validated in updateSettings.
 */
const router = Router();

router.get("/content-pages", (_req, res) => {
  res.json({ contentPages: getSettings().contentPages ?? [] });
});

router.put("/content-pages", requireRole("pmo"), (req, res) => {
  const contentPages = (req.body as { contentPages?: unknown })?.contentPages;
  try {
    const settings = updateSettings({ contentPages });
    captureVersion("content pages updated");
    res.json({ contentPages: settings.contentPages });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;
