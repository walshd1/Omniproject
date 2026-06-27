/**
 * Licence endpoint — GET /api/license reports the current licence summary +
 * premium-feature entitlements (white-label, webhooks, enterprise workflows). The
 * entitlement logic + the pre-community "free to run" stance live in lib/license.
 */
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
