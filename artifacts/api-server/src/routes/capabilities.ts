import { Router } from "express";
import { resolveCapabilities, resolveFieldManifest } from "../lib/capabilities";
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
