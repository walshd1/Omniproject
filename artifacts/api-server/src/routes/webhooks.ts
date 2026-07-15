/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router } from "express";
import { listWebhooks, buildWebhook, webhooksWith, deleteWebhook, testWebhook, WebhookNotFoundError, WEBHOOK_EVENTS } from "../lib/webhooks";
import { requireRole } from "../lib/rbac";
import { requireStepUp } from "../lib/step-up";
import { requireEntitlement, isEntitled } from "../lib/license";
import { applySettingsGuarded } from "../lib/settings-guard";
import { captureVersion } from "../lib/config-store";
import { actorForAudit } from "../lib/audit";

/**
 * Outbound webhook management (premium: `webhooks`). Admin only.
 *
 *  - GET    /api/webhooks            — list subscriptions (secrets redacted)
 *  - POST   /api/webhooks            — create (entitlement required)
 *  - DELETE /api/webhooks/:id        — remove
 *  - POST   /api/webhooks/:id/test   — send a test delivery (entitlement required)
 */
const router = Router();

router.get("/webhooks", requireRole("admin"), (_req, res) => {
  res.json({ entitled: isEntitled("webhooks"), events: WEBHOOK_EVENTS, webhooks: listWebhooks() });
});

router.post("/webhooks", requireRole("admin"), requireStepUp, requireEntitlement("webhooks"), async (req, res) => {
  try {
    // Build the subscription (validates + mints the id/secret) without touching settings, then persist it
    // UNDER THE INVARIANT (§0): a webhook opens a new egress channel, so an ADD is a security reduction and
    // is held for a signed sign-off; the sealed patch applies via the executor once the chain approves. The
    // plaintext secret is surfaced ONCE here either way (applied now, or so the operator can configure the
    // receiver while the sign-off is pending) — subsequent GETs only report whether a secret is set.
    const sub = buildWebhook(req.body);
    const guarded = await applySettingsGuarded({ webhooks: webhooksWith(sub) }, actorForAudit(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({ pending: guarded.pending, webhook: sub, message: "Adding a webhook opens a new egress channel and needs a signed sign-off before it goes live. See /api/approvals/inbox. The signing secret is shown once, here." });
      return;
    }
    captureVersion("webhook created");
    res.status(201).json({ created: true, webhook: sub });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid webhook" });
  }
});

router.delete("/webhooks/:id", requireRole("admin"), requireStepUp, (req, res) => {
  try {
    deleteWebhook(String(req.params["id"]));
    res.json({ deleted: true });
  } catch (err) {
    if (err instanceof WebhookNotFoundError) { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

router.post("/webhooks/:id/test", requireRole("admin"), requireEntitlement("webhooks"), async (req, res) => {
  try {
    const result = await testWebhook(String(req.params["id"]));
    res.json({ tested: true, result });
  } catch (err) {
    if (err instanceof WebhookNotFoundError) { res.status(404).json({ error: err.message }); return; }
    throw err;
  }
});

export default router;