import { Router } from "express";
import { devModeStatus } from "../lib/dev-mode";

/**
 * GET /api/dev-mode — public, unauthenticated status of dev/debug mode, so the SPA
 * can watermark the screen the moment it loads (even pre-auth). Returns only which
 * debug surfaces are armed — never paths, secrets, or data. In production this
 * always reports `{ devMode: false }` (dev mode is hard-gated off there).
 */
const router = Router();

router.get("/dev-mode", (_req, res) => {
  res.json(devModeStatus());
});

export default router;
