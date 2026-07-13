/**
 * Setup environments plane — the sandbox → promote → rollback lifecycle over versioned config:
 * list/create/activate environments, promote one env's config onto another, pin a known-good
 * version, and fast-rollback. Split out of the setup god router (Stage 3) as one cohesive concern:
 * every route is an admin-gated operation on the config-store's environment/version model.
 *
 * Mounted by ./setup.ts under the same base, so every path stays `/setup/...` exactly as before.
 */
import { Router, type Response } from "express";
import { requireRole } from "../../lib/rbac";
import {
  storeView,
  storeViewShared,
  createEnvironment,
  activateEnvironment,
  markKnownGood,
  rollbackTo,
  rollbackToLastKnownGood,
  promote,
} from "../../lib/config-store";

const router = Router();

/** Run a config-store mutation and surface a thrown domain error as a 400 (the store validates env
 *  names / version ids); the happy path returns the store's own result shape. */
function handle(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "error" });
  }
}

// GET /api/setup/environments — environments, active env, version history (fleet-wide when
// Redis-backed, else this replica's local history).
router.get("/setup/environments", requireRole("admin"), async (_req, res) => {
  res.json(await storeViewShared());
});

// POST /api/setup/environments { name } — create a sandbox (clone of active).
router.post("/setup/environments", requireRole("admin"), (req, res) => {
  handle(res, () => createEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/environments/activate { name } — switch the active environment.
router.post("/setup/environments/activate", requireRole("admin"), (req, res) => {
  handle(res, () => activateEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/promote { from, to } — copy one env's config onto another.
router.post("/setup/promote", requireRole("admin"), (req, res) => {
  handle(res, () => promote(String(req.body?.from ?? ""), String(req.body?.to ?? "")));
});

// POST /api/setup/versions/:id/known-good — pin a version as known-good.
router.post("/setup/versions/:id/known-good", requireRole("admin"), (req, res) => {
  handle(res, () => markKnownGood(String(req.params["id"])));
});

// POST /api/setup/rollback { versionId? , toKnownGood? } — fast rollback.
router.post("/setup/rollback", requireRole("admin"), (req, res) => {
  try {
    const result = req.body?.toKnownGood
      ? rollbackToLastKnownGood()
      : rollbackTo(String(req.body?.versionId ?? ""));
    res.json({ rolledBack: true, appliedVersion: result.applied.id, warnings: result.warnings, store: storeView() });
  } catch (err) {
    res.status(400).json({ rolledBack: false, error: err instanceof Error ? err.message : "error" });
  }
});

export default router;
