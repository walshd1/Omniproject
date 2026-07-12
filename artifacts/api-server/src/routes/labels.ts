/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { Router } from "express";
import { effectiveLabels, saveLabels } from "../lib/labels";
import { nomenclaturePresets, applyNomenclaturePreset } from "../lib/nomenclature";
import { requireAnyRole } from "../lib/rbac";
import { emitWebhookEvent } from "../lib/webhooks";

/**
 * Company-nomenclature label overrides (historically the premium `labels` feature). The premium
 * entitlement gate is currently DISABLED (see lib/labels.ts `LABELS_PREMIUM_GATE`) — nomenclature is
 * treated as a standard PMO/admin governance knob, so writes are role-gated (PMO or admin) rather
 * than entitlement-gated.
 *
 *  - GET /api/labels — public; effective overrides + the catalogue of overridable
 *    terms with their defaults.
 *  - PUT /api/labels — PMO or admin.
 *  - GET /api/labels/presets — public; the per-vendor nomenclature presets.
 *  - POST /api/labels/apply-preset — PMO or admin; adopt a vendor's wording.
 */
const router = Router();

router.get("/labels", (_req, res) => {
  res.json(effectiveLabels());
});

router.put("/labels", requireAnyRole("pmo", "admin"), (req, res) => {
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
router.post("/labels/apply-preset", requireAnyRole("pmo", "admin"), (req, res) => {
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