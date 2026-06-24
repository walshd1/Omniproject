import { Router } from "express";
import { effectiveLabels, saveLabels } from "../lib/labels";
import { requireRole } from "../lib/rbac";
import { requireEntitlement } from "../lib/license";
import { emitWebhookEvent } from "../lib/webhooks";

/**
 * Company-nomenclature label overrides (premium: `labels`).
 *
 *  - GET /api/labels — public; effective overrides ({} unless entitled) + the
 *    catalogue of overridable terms with their defaults.
 *  - PUT /api/labels — admin + entitlement. 402 if unlicensed.
 */
const router = Router();

router.get("/labels", (_req, res) => {
  res.json(effectiveLabels());
});

router.put("/labels", requireRole("admin"), requireEntitlement("labels"), (req, res) => {
  try {
    const overrides = saveLabels(req.body?.overrides ?? req.body);
    emitWebhookEvent("config.changed", { kind: "labels" });
    res.json({ saved: true, ...effectiveLabels(), overrides });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid labels" });
  }
});

export default router;
