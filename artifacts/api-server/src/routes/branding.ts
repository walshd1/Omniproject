import { Router } from "express";
import { effectiveBranding, saveBranding, clearBranding } from "../lib/branding";
import { requireRole } from "../lib/rbac";
import { requireEntitlement } from "../lib/license";
import { emitWebhookEvent } from "../lib/webhooks";

/**
 * White-label branding (premium: `branding`).
 *
 *  - GET  /api/branding — public (the login screen needs it pre-auth). Returns
 *    the effective branding (product defaults unless entitled + configured).
 *  - PUT  /api/branding — admin + entitlement. Save overrides. 402 if unlicensed.
 *  - DELETE /api/branding — admin. Revert to product defaults.
 */
const router = Router();

router.get("/branding", (_req, res) => {
  res.json(effectiveBranding());
});

router.put("/branding", requireRole("admin"), requireEntitlement("branding"), (req, res) => {
  try {
    const saved = saveBranding(req.body);
    emitWebhookEvent("config.changed", { kind: "branding" });
    res.json({ saved: true, branding: saved, effective: effectiveBranding() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid branding" });
  }
});

router.delete("/branding", requireRole("admin"), (_req, res) => {
  clearBranding();
  emitWebhookEvent("config.changed", { kind: "branding", cleared: true });
  res.json({ cleared: true, effective: effectiveBranding() });
});

export default router;
