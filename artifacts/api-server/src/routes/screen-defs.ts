import { Router } from "express";
import { resolveScreenDefs } from "../lib/screen-store";

/**
 * Org-authored SCREEN DEFINITIONS (roadmap X.10 — screens convergence). Screen overrides are DEFINITIONS
 * authored through the importer (`POST`/`PUT /api/defs`, kind `screen`) into the encrypted def store; the SPA
 * merges them over its built-in catalogue by id. `GET /screen-defs/resolved` serves the effective override set
 * (org/project/user def store, nearest scope winning) the SPA renders from.
 */
const router = Router();

// GET /api/screen-defs/resolved — the effective override set (org/project/user def-store screens, nearest
// scope winning by id). The SPA merges THESE over its built-in catalogue.
router.get("/screen-defs/resolved", (req, res) => {
  res.json({ screenDefs: resolveScreenDefs(req) });
});

export default router;
