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
import { mountCommand, type CommandDescriptor } from "../../lib/action-base";
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

// GET /api/setup/environments — environments, active env, version history (fleet-wide when
// Redis-backed, else this replica's local history).
router.get("/setup/environments", requireRole("admin"), async (_req, res) => {
  res.json(await storeViewShared());
});

/**
 * LANE 2: the config-store lifecycle verbs (create/activate a sandbox env, promote config between envs, pin a
 * known-good version, fast-rollback) are admin mutations on the versioned config store. Each is a mountCommand
 * whose `run` calls the store and returns its result; a thrown domain error (bad env name / version id — the
 * store validates) surfaces as a 400 via onError, exactly as the hand-written `handle()` wrapper did. Each
 * gains a success audit the wrapper lacked (additive, no-op under default config).
 */
const store400: (res: Response, err: unknown) => void = (res, err) => {
  res.status(400).json({ error: err instanceof Error ? err.message : "error" });
};

// POST /api/setup/environments { name } — create a sandbox (clone of active).
export const setupEnvironmentCreateCommand: CommandDescriptor<{ name: string }> = {
  name: "setup.environments.create",
  method: "post",
  path: "/setup/environments",
  role: "admin",
  parse: (req) => ({ name: String(req.body?.name ?? "") }),
  run: async (_req, _res, { name }) => createEnvironment(name),
  audit: "setup.environments.create",
  auditCategory: "admin",
  onError: store400,
};
mountCommand(router, setupEnvironmentCreateCommand);

// POST /api/setup/environments/activate { name } — switch the active environment.
export const setupEnvironmentActivateCommand: CommandDescriptor<{ name: string }> = {
  name: "setup.environments.activate",
  method: "post",
  path: "/setup/environments/activate",
  role: "admin",
  parse: (req) => ({ name: String(req.body?.name ?? "") }),
  run: async (_req, _res, { name }) => activateEnvironment(name),
  audit: "setup.environments.activate",
  auditCategory: "admin",
  onError: store400,
};
mountCommand(router, setupEnvironmentActivateCommand);

// POST /api/setup/promote { from, to } — copy one env's config onto another.
export const setupPromoteCommand: CommandDescriptor<{ from: string; to: string }> = {
  name: "setup.promote",
  method: "post",
  path: "/setup/promote",
  role: "admin",
  parse: (req) => ({ from: String(req.body?.from ?? ""), to: String(req.body?.to ?? "") }),
  run: async (_req, _res, { from, to }) => promote(from, to),
  audit: "setup.promote",
  auditCategory: "admin",
  onError: store400,
};
mountCommand(router, setupPromoteCommand);

// POST /api/setup/versions/:id/known-good — pin a version as known-good.
export const setupVersionKnownGoodCommand: CommandDescriptor<{ id: string }> = {
  name: "setup.version.known-good",
  method: "post",
  path: "/setup/versions/:id/known-good",
  role: "admin",
  parse: (req) => ({ id: String(req.params["id"]) }),
  run: async (_req, _res, { id }) => markKnownGood(id),
  audit: "setup.version.known-good",
  auditCategory: "admin",
  onError: store400,
};
mountCommand(router, setupVersionKnownGoodCommand);

// POST /api/setup/rollback { versionId? , toKnownGood? } — fast rollback (custom result shape + error body).
export const setupRollbackCommand: CommandDescriptor<{ toKnownGood: boolean; versionId: string }> = {
  name: "setup.rollback",
  method: "post",
  path: "/setup/rollback",
  role: "admin",
  parse: (req) => ({ toKnownGood: Boolean((req.body as { toKnownGood?: unknown } | undefined)?.toKnownGood), versionId: String(req.body?.versionId ?? "") }),
  run: async (_req, _res, { toKnownGood, versionId }) => {
    const result = toKnownGood ? rollbackToLastKnownGood() : rollbackTo(versionId);
    return { rolledBack: true, appliedVersion: result.applied.id, warnings: result.warnings, store: storeView() };
  },
  audit: "setup.rollback",
  auditCategory: "admin",
  onError: (res, err) => { res.status(400).json({ rolledBack: false, error: err instanceof Error ? err.message : "error" }); },
};
mountCommand(router, setupRollbackCommand);

export default router;
