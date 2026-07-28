import { Router } from "express";
import { requireRole, getRoleMap, setRoleMap, rollbackRoleMap, canRollbackRoleMap, ROLES } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";
import { recordRequestAudit } from "../lib/audit";
import { persistSecurityState } from "../lib/security-state";
import { heldForDualControl } from "./security";
import { findSeparationOfDutiesConflicts } from "@workspace/backend-catalogue";
import { sodPolicyState, prospectiveRoleMap, roleMapToSoDAssignments } from "../lib/sod-policy";

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
  res.json({ roles: ROLES, mapping: getRoleMap(), rollbackAvailable: canRollbackRoleMap() });
});

// One-generation undo for the last role-map change — same step-up gate as the edit it
// reverses, since restoring an old mapping is exactly as consequential as setting a new one.
// LANE 2: the action base runs the shell (admin + step-up → ruleset → run → audit).
export const roleMapRollbackCommand: CommandDescriptor<Record<string, never>> = {
  name: "role_map_rollback",
  method: "post",
  path: "/admin/role-map/rollback",
  role: "admin",
  gates: [requireStepUp],
  parse: () => ({}),
  run: async () => {
    const rolledBack = rollbackRoleMap();
    const mapping = getRoleMap();
    persistSecurityState(); // durable + fleet-published: the reverted mapping propagates like the edit did
    return { roles: ROLES, mapping, rolledBack };
  },
  audit: "role_map_rollback",
  auditCategory: "admin",
  auditStatus: 200,
  auditMeta: (_req, _args, result) => ({ rolledBack: (result as { rolledBack: boolean }).rolledBack }),
};
mountCommand(router, roleMapRollbackCommand);

router.put("/admin/role-map", requireRole("admin"), requireStepUp, async (req, res) => {
  // SEPARATION OF DUTIES (IAM S3): reject a mapping that would grant one IdP group a toxic combination
  // of authorities (e.g. both `admin` and `pmo`) BEFORE it is proposed — so the control holds whether or
  // not dual-control is on (a held proposal applies later via the executor, bypassing a post-hold check).
  // Inert unless SOD_POLICIES is set; fail-closed if SOD_POLICIES is present but unparseable (an
  // unprovable policy set can't attest the edit is SoD-clean, so refuse rather than silently skip).
  const sod = sodPolicyState();
  if (sod.error) {
    recordRequestAudit(req, { category: "admin", action: "role_map_update", result: "error", status: 500, meta: { sodPolicyError: sod.error } });
    res.status(500).json({ error: "Separation-of-duties policy is misconfigured", detail: sod.error });
    return;
  }
  if (sod.policies.length > 0) {
    const assignments = roleMapToSoDAssignments(prospectiveRoleMap(getRoleMap(), req.body));
    const { conflicts } = findSeparationOfDutiesConflicts(assignments, sod.policies);
    if (conflicts.length > 0) {
      recordRequestAudit(req, {
        category: "admin",
        action: "role_map_update",
        result: "error",
        status: 409,
        meta: { sodConflicts: conflicts.map((c) => ({ subject: c.subjectId, policy: c.policyId, severity: c.severity })) },
      });
      res.status(409).json({ error: "Separation-of-duties conflict", conflicts });
      return;
    }
  }
  // Four-eyes: mapping an IdP group to admin/pmo authority is an elevation, so when configured it
  // requires a SECOND admin's approval (held as a proposal) before it takes effect. No-op when
  // role_map.update isn't in DUAL_CONTROL_ACTIONS (single-admin deployments unaffected).
  if (await heldForDualControl("role_map.update", req.body, req, res)) return;
  const mapping = setRoleMap(req.body);
  persistSecurityState(); // durable across restart + fanned out to the fleet (revocation propagates)
  recordRequestAudit(req, {
    category: "admin",
    action: "role_map_update",
    result: "success",
    status: 200,
    // Record the shape of the change (group counts per role), not necessarily the
    // group names — enough for an audit trail without bloating it.
    meta: { overrides: mapping.filter((m) => m.source === "override").map((m) => ({ role: m.role, groups: m.claims.length })) },
  });
  res.json({ roles: ROLES, mapping });
});

export default router;
