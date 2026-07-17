/**
 * Capability + field-manifest endpoints. GET /api/capabilities reports which data
 * domains the connected backend(s) can populate (so the UI gates features); GET
 * /api/fields/manifest reconciles the backend's fields against the canonical
 * registry. Read-only; the gating logic itself lives in lib/capabilities.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { resolveCapabilities, resolveFieldManifest, resolveLiveSuperset } from "../lib/capabilities";
import { resolveAvailability } from "../lib/availability";
import { requireRole, roleForReq } from "../lib/rbac";
import { settingsCollectionRouter } from "../lib/settings-collection-router";

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

// GET/PATCH /api/availability/curation — the hidden-field list (view-curation). Admin OR PMO on
// both verbs; the write can only HIDE available fields, persisted to the config bundle
// (settings.hiddenFields). A settings-collection instance with the read guarded too, since the
// curation panel is admin/PMO.
router.use(
  settingsCollectionRouter({
    path: "/availability/curation",
    settingsKey: "hiddenFields",
    versionLabel: "field visibility curated",
    method: "patch",
    readGuards: [requireAdminOrPmo],
    writeGuards: [requireAdminOrPmo],
  }),
);

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

// GET /api/fields/superset — the LIVE superset the mapping picker binds to: every field mappable right now
// (connected backends + the sidecar when on), duplicates kept distinct, each carrying origin + type + limits.
// Manager+ (same schema-detail exposure as the manifest).
router.get("/fields/superset", requireRole("manager"), async (req, res) => {
  try {
    res.json({ fields: await resolveLiveSuperset(req) });
  } catch (err) {
    req.log.error({ err }, "live superset resolution failed");
    res.status(502).json({ error: "Could not resolve the live superset" });
  }
});

export default router;
