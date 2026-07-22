import { Router } from "express";
import { requireAnyRole } from "../lib/rbac";
import { requireArtifactStore } from "../lib/artifact-store";
import { resolveDelegationPolicy, writeOrgConfigCollection, DELEGATION_POLICY_ID } from "../lib/scoped-config";
import { cleanDelegationPolicy, DELEGATION_AREAS, DELEGATION_LEVELS } from "@workspace/backend-catalogue";
import { recordRequestAudit } from "../lib/audit";

/**
 * DELEGATION POLICY — the org's governance dial for how far DOWN the scope hierarchy local variation is
 * allowed, per governed area (ruleset / settings / methodology). "Set the level of local variation you'll
 * allow, and no further." Read is any authed user (so a scope-owner UI can show what it may do); write is a
 * governance action (PMO/admin) — it governs rulesets & methodology, which the same authorities own. Stored as
 * an org config def, defaulting to fully centralized.
 *
 *  - GET  /api/admin/delegation-policy — the current policy + the vocabulary (areas + levels) for the picker.
 *  - PUT  /api/admin/delegation-policy — set it (admin). Body: `{ policy: { <area>: <level>, … } }`, sanitised.
 */
const router = Router();

router.get("/admin/delegation-policy", (_req, res) => {
  res.json({ policy: resolveDelegationPolicy(), areas: DELEGATION_AREAS, levels: DELEGATION_LEVELS });
});

router.put("/admin/delegation-policy", requireAnyRole("pmo", "admin"), (req, res) => {
  if (!requireArtifactStore(res)) return;
  const raw = (req.body as { policy?: unknown } | undefined)?.policy;
  const policy = cleanDelegationPolicy(raw);
  writeOrgConfigCollection(DELEGATION_POLICY_ID, "Delegation policy", policy);
  recordRequestAudit(req, {
    category: "admin", action: "delegation_policy_set", result: "success", status: 200,
    meta: { policy },
  });
  res.json({ policy: resolveDelegationPolicy() });
});

export default router;
