/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router } from "express";
import { effectiveBranding, saveBranding, clearBranding } from "../lib/branding";
import { requireEntitlement } from "../lib/license";
import { emitWebhookEvent } from "../lib/webhooks";
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

/**
 * White-label branding (premium: `branding`).
 *
 *  - GET  /api/branding — public (the login screen needs it pre-auth). Returns
 *    the effective branding (product defaults unless entitled + configured).
 *  - PUT  /api/branding — admin + entitlement. Save overrides. 402 if unlicensed.
 *  - DELETE /api/branding — admin. Revert to product defaults.
 *
 * LANE 2: the two writes are admin config verbs, so each is a mountCommand descriptor. The invalid-body 400
 * on PUT maps via onError. NOTE: the hand-written routes did not audit; the action base now records a success
 * audit (branding.save / branding.clear) — an additive gap-closure, the same spirit as the ruleset gap-closure
 * every migrated command carries.
 */
const router = Router();

router.get("/branding", (_req, res) => {
  res.json(effectiveBranding());
});

export const brandingSaveCommand: CommandDescriptor<{ body: unknown }> = {
  name: "branding.save",
  method: "put",
  path: "/branding",
  role: "admin",
  gates: [requireEntitlement("branding")],
  parse: (req) => ({ body: req.body }),
  run: async (_req, _res, { body }) => {
    const saved = saveBranding(body);
    emitWebhookEvent("config.changed", { kind: "branding" });
    return { saved: true, branding: saved, effective: effectiveBranding() };
  },
  audit: "branding.save",
  auditCategory: "admin",
  onError: (res, err) => { res.status(400).json({ error: err instanceof Error ? err.message : "invalid branding" }); },
};
mountCommand(router, brandingSaveCommand);

export const brandingClearCommand: CommandDescriptor<Record<string, never>> = {
  name: "branding.clear",
  method: "delete",
  path: "/branding",
  role: "admin",
  parse: () => ({}),
  run: async () => {
    clearBranding();
    emitWebhookEvent("config.changed", { kind: "branding", cleared: true });
    return { cleared: true, effective: effectiveBranding() };
  },
  audit: "branding.clear",
  auditCategory: "admin",
};
mountCommand(router, brandingClearCommand);

export default router;