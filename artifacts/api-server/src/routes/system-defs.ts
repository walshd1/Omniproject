import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { recordRequestAudit } from "../lib/audit";
import { requireArtifactStore } from "../lib/artifact-store";
import { listSystemDefs } from "../lib/def-import";
import { applySystemDefaults } from "../lib/system-defs";

/**
 * The SYSTEM DEFAULTS update mechanism (roadmap X.11). The system def store holds OUR shipped defaults
 * (reports/forms/business-rules/dashboards …), read-only to customers. There is deliberately **no importer/editor
 * write path** to it. This is the ONLY runtime way to update it, and it is tightly constrained:
 *   - **admin-gated + step-up** — as consequential as any core-config change;
 *   - **content is fixed to OUR bundled catalogue** — the route takes NO def payload, so an admin can only APPLY
 *     the approved-from-us defaults, never inject their own into the system tier;
 *   - the write is the **one-shot** decrypt→replace→re-encrypt (`applySystemDefaults`), never per-item.
 */
const router = Router();

// GET /api/admin/system-defs — a read-only summary of the installed shipped defaults (count per kind). Admin.
router.get("/admin/system-defs", requireRole("admin"), (_req, res) => {
  const byKind: Record<string, number> = {};
  for (const d of listSystemDefs()) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  res.json({ total: listSystemDefs().length, byKind });
});

// POST /api/admin/system-defs/apply — (re)apply OUR bundled defaults in one shot. Admin + step-up. No body:
// the content is always the approved-from-us catalogue, so this can't be used to inject custom system defs.
router.post("/admin/system-defs/apply", requireRole("admin"), requireStepUp, (req, res) => {
  if (!requireArtifactStore(res)) return;
  const { count } = applySystemDefaults();
  recordRequestAudit(req, { category: "admin", action: "system_defs_apply", write: true, meta: { count } });
  res.json({ applied: true, count });
});

export default router;
