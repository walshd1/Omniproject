import { Router } from "express";
import { licenseSummary } from "../lib/license";

const router = Router();

/**
 * GET /api/license — current entitlement status (no signature material).
 * Any authenticated principal may read it so the UI can show which premium
 * features are unlocked / locked.
 */
router.get("/license", (_req, res) => {
  res.json(licenseSummary());
});

export default router;
