import { Router } from "express";
import { featureStatus } from "../lib/feature-modules";

/**
 * Feature-module status, so the SPA can lazily gate optional UI and the admin panel can show
 * what's on/off (and what needs a restart to load). Readable by any authenticated session;
 * toggling is an admin write via PATCH /api/settings { disabledFeatures }.
 */
const router = Router();

router.get("/features", (_req, res) => {
  res.json({ features: featureStatus() });
});

export default router;
