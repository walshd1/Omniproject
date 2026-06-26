/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router } from "express";
import { listWebhooks, createWebhook, deleteWebhook, testWebhook, WEBHOOK_EVENTS } from "../lib/webhooks";
import { requireRole } from "../lib/rbac";
import { requireEntitlement, isEntitled } from "../lib/license";

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

router.post("/webhooks", requireRole("admin"), requireEntitlement("webhooks"), (req, res) => {
  try {
    const created = createWebhook(req.body);
    // The plaintext secret is returned ONCE so the operator can configure the
    // receiver; subsequent GETs only report whether a secret is set.
    res.status(201).json({ created: true, webhook: created });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid webhook" });
  }
});

router.delete("/webhooks/:id", requireRole("admin"), (req, res) => {
  const ok = deleteWebhook(String(req.params["id"]));
  if (!ok) {
    res.status(404).json({ error: "Unknown webhook id" });
    return;
  }
  res.json({ deleted: true });
});

router.post("/webhooks/:id/test", requireRole("admin"), requireEntitlement("webhooks"), async (req, res) => {
  const result = await testWebhook(String(req.params["id"]));
  if (!result) {
    res.status(404).json({ error: "Unknown webhook id" });
    return;
  }
  res.json({ tested: true, result });
});

export default router;