/**
 * Capability + field-manifest endpoints. GET /api/capabilities reports which data
 * domains the connected backend(s) can populate (so the UI gates features); GET
 * /api/fields/manifest reconciles the backend's fields against the canonical
 * registry. Read-only; the gating logic itself lives in lib/capabilities.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { resolveCapabilities, resolveFieldManifest } from "../lib/capabilities";
import { resolveAvailability } from "../lib/availability";
import { requireRole, roleForReq } from "../lib/rbac";
import { getSettings, updateSettings, SettingsValidationError } from "../lib/settings";
import { captureVersion } from "../lib/config-store";

const router = Router();

/** Allow EITHER authority — admin (technical config) OR pmo (business governance) — to curate the
 *  view. Field visibility is a PMO concern as much as an admin one, so it isn't admin-only. */
function requireAdminOrPmo(req: Request, res: Response, next: NextFunction): void {
  const role = roleForReq(req);
  if (role === "admin" || role === "pmo") { next(); return; }
  res.status(403).json({ error: "admin or pmo role required" });
}

// GET /api/capabilities — which data domains the backend(s) can populate.
router.get("/capabilities", async (req, res) => {
  try {
    res.json(await resolveCapabilities(req));
  } catch (err) {
    req.log.error({ err }, "capabilities resolution failed");
    res.status(502).json({ error: "Could not resolve capabilities" });
  }
});

// GET /api/availability — what the connected backend ACTUALLY surfaces: superset ∩ (the backend's
// schema manifest if it provides one — the stateful-DB path — else the static capability flags).
// Read-only; the SPA uses it to show only the fields/tables the backend genuinely has.
router.get("/availability", async (req, res) => {
  try {
    res.json(await resolveAvailability(req));
  } catch (err) {
    req.log.error({ err }, "availability resolution failed");
    res.status(502).json({ error: "Could not resolve availability" });
  }
});

// PATCH /api/availability/curation — admin OR PMO sets the hidden-field list (view-curation). It
// can only HIDE available fields; persisted to the config bundle (settings.hiddenFields).
router.patch("/availability/curation", requireAdminOrPmo, (req, res) => {
  const hiddenFields = (req.body as { hiddenFields?: unknown })?.hiddenFields;
  try {
    const settings = updateSettings({ hiddenFields });
    captureVersion("field visibility curated");
    res.json({ hiddenFields: settings.hiddenFields });
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
});

// GET /api/availability/curation — the current hidden-field list (admin/PMO panel reads it).
router.get("/availability/curation", requireAdminOrPmo, (_req, res) => {
  res.json({ hiddenFields: getSettings().hiddenFields ?? [] });
});

// GET /api/fields/manifest — the describe → reconcile path made inspectable.
// Manager+ because it reveals backend schema detail (every field the backend
// exposes, incl. unmapped/custom ones).
router.get("/fields/manifest", requireRole("manager"), async (req, res) => {
  try {
    res.json(await resolveFieldManifest(req));
  } catch (err) {
    req.log.error({ err }, "field manifest resolution failed");
    res.status(502).json({ error: "Could not resolve field manifest" });
  }
});

export default router;
