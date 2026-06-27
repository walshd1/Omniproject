/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router } from "express";
import { effectiveLabels, saveLabels } from "../lib/labels";
import { nomenclaturePresets, applyNomenclaturePreset } from "../lib/nomenclature";
import { requireRole } from "../lib/rbac";
import { requireEntitlement } from "../lib/license";
import { emitWebhookEvent } from "../lib/webhooks";

/**
 * Company-nomenclature label overrides (premium: `labels`).
 *
 *  - GET /api/labels — public; effective overrides ({} unless entitled) + the
 *    catalogue of overridable terms with their defaults.
 *  - PUT /api/labels — admin + entitlement. 402 if unlicensed.
 *  - GET /api/labels/presets — public; the per-vendor nomenclature presets.
 *  - POST /api/labels/apply-preset — admin + entitlement; adopt a vendor's wording.
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

// The vendor nomenclature presets a customer can adopt (public, like GET /labels).
router.get("/labels/presets", (_req, res) => {
  res.json({ presets: nomenclaturePresets() });
});

// Adopt one vendor's nomenclature in a click — writes it through the label overrides.
router.post("/labels/apply-preset", requireRole("admin"), requireEntitlement("labels"), (req, res) => {
  const backendId = String(req.body?.backendId ?? "");
  try {
    const overrides = applyNomenclaturePreset(backendId);
    if (!overrides) {
      res.status(404).json({ error: `no nomenclature preset for backend "${backendId}"` });
      return;
    }
    emitWebhookEvent("config.changed", { kind: "labels" });
    res.json({ saved: true, ...effectiveLabels(), overrides });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid preset" });
  }
});

export default router;