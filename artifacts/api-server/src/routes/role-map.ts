import { Router } from "express";
import { requireRole, roleForReq, getRoleMap, setRoleMap, ROLES } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { getSession } from "./auth";
import { recordAudit } from "../lib/audit";

/**
 * Role-mapping editor — ADMIN-only, audited. Lets an admin decide which IdP
 * groups/claims land in each of the FIXED OmniProject roles (the editable form of
 * the OIDC_*_ROLES env). It is deliberately NOT a permission/role creator: the set
 * of roles and their gates are fixed in code (statically verifiable), so this can
 * only assign groups to an existing role — it can never invent a role or grant a
 * permission. Technical config ⇒ admin-gated, not PMO.
 */
const router = Router();

router.get("/admin/role-map", requireRole("admin"), (_req, res) => {
  res.json({ roles: ROLES, mapping: getRoleMap() });
});

router.put("/admin/role-map", requireRole("admin"), requireStepUp, (req, res) => {
  const mapping = setRoleMap(req.body);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "role_map_update",
    actor: getSession(req) ? { sub: getSession(req)!.sub, role: roleForReq(req) } : null,
    result: "success",
    status: 200,
    // Record the shape of the change (group counts per role), not necessarily the
    // group names — enough for an audit trail without bloating it.
    meta: { overrides: mapping.filter((m) => m.source === "override").map((m) => ({ role: m.role, groups: m.claims.length })) },
  });
  res.json({ roles: ROLES, mapping });
});

export default router;
