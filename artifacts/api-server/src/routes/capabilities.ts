/**
 * Capability + field-manifest endpoints. GET /api/capabilities reports which data
 * domains the connected backend(s) can populate (so the UI gates features); GET
 * /api/fields/manifest reconciles the backend's fields against the canonical
 * registry. Read-only; the gating logic itself lives in lib/capabilities.
 */
import { Router } from "express";
import { resolveCapabilities, resolveFieldManifest } from "../lib/capabilities";
import { resolveAvailability } from "../lib/availability";
import { requireRole } from "../lib/rbac";

const router = Router();

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
