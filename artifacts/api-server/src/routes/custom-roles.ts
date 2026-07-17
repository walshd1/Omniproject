import { Router } from "express";
import { requireRole, ROLES } from "../lib/rbac";
import { recordRequestAudit } from "../lib/audit";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { listCapabilities } from "../lib/capability-governance";
import {
  getCustomRolesConfig, setCustomRolesConfig, CustomRolesError, CUSTOM_ROLE_BASES,
} from "../lib/custom-roles";

/**
 * ADMIN custom-roles + permission-sets editor. An admin names their own roles (each GROUNDED in a fixed base
 * role — the hard grant ceiling) and permission bundles (named sets of governance capabilities). Admin-only;
 * technical config ⇒ admin, not PMO. Defining a custom role can never confer more than its base role (which
 * an admin can already grant via the role-map), so this is a labelling/bundling convenience, not a new
 * privilege vector.
 */
const router = Router();

// GET /api/admin/custom-roles — the current config + the pickers the editor needs (base roles + capabilities).
router.get("/admin/custom-roles", requireRole("admin"), (_req, res) => {
  res.json({
    config: getCustomRolesConfig(),
    baseRoles: CUSTOM_ROLE_BASES,
    roles: ROLES,
    capabilities: listCapabilities().map((c) => ({ id: c.id, label: c.label, kind: c.kind })),
  });
});

// PUT /api/admin/custom-roles — replace the whole config (validated + referential-integrity-checked).
router.put("/admin/custom-roles", requireRole("admin"), (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  let config;
  try { config = setCustomRolesConfig(req.body); }
  catch (e) { if (e instanceof CustomRolesError) { res.status(400).json({ error: e.message }); return; } throw e; }
  recordRequestAudit(req, {
    category: "admin",
    action: "custom_roles_update",
    write: true,
    meta: { permissionSets: config.permissionSets.length, customRoles: config.customRoles.length },
  });
  res.json({ config });
});

export default router;
