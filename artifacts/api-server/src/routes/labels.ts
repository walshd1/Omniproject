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
import { mountCommand, type CommandDescriptor } from "../lib/action-base";

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
 *
 * LANE 2: the two writes are PMO/admin governance verbs, so each is a mountCommand descriptor — the
 * PMO-or-admin union gate rides in `gates` (a role floor is a single role; a union is middleware). The
 * invalid-body 400 maps via onError; apply-preset's unknown-preset case throws `NoNomenclaturePresetError`
 * so onError returns the 404 WITHOUT recording a success audit (the same "not-found audits nothing" shape as
 * users.ts). NOTE: the hand-written routes did not audit; the action base now records a success audit
 * (labels.save / labels.apply-preset) — an additive gap-closure, the same spirit as branding. No-op under
 * default config. The two public GETs are untouched.
 */
const router = Router();

router.get("/labels", (_req, res) => {
  res.json(effectiveLabels());
});

// The vendor nomenclature presets a customer can adopt (public, like GET /labels).
router.get("/labels/presets", (_req, res) => {
  res.json({ presets: nomenclaturePresets() });
});

export const labelsSaveCommand: CommandDescriptor<{ body: { overrides?: unknown } | undefined }> = {
  name: "labels.save",
  method: "put",
  path: "/labels",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req) => ({ body: req.body }),
  run: async (_req, _res, { body }) => {
    const overrides = saveLabels(body?.overrides ?? body);
    emitWebhookEvent("config.changed", { kind: "labels" });
    return { saved: true, ...effectiveLabels(), overrides };
  },
  audit: "labels.save",
  auditCategory: "admin",
  onError: (res, err) => { res.status(400).json({ error: err instanceof Error ? err.message : "invalid labels" }); },
};
mountCommand(router, labelsSaveCommand);

/** Raised inside apply-preset's `run` when the backend has no nomenclature preset — mapped to 404 by
 *  `onError`, so an unknown preset records NO success audit (mirrors users.ts' not-found shape). */
class NoNomenclaturePresetError extends Error {
  constructor(public readonly backendId: string) { super(`no nomenclature preset for backend "${backendId}"`); }
}

export const labelsApplyPresetCommand: CommandDescriptor<{ backendId: string }> = {
  name: "labels.apply-preset",
  method: "post",
  path: "/labels/apply-preset",
  gates: [requireAnyRole("pmo", "admin")],
  parse: (req) => ({ backendId: String(req.body?.backendId ?? "") }),
  run: async (_req, _res, { backendId }) => {
    const overrides = applyNomenclaturePreset(backendId);
    if (!overrides) throw new NoNomenclaturePresetError(backendId);
    emitWebhookEvent("config.changed", { kind: "labels" });
    return { saved: true, ...effectiveLabels(), overrides };
  },
  audit: "labels.apply-preset",
  auditCategory: "admin",
  onError: (res, err) => {
    if (err instanceof NoNomenclaturePresetError) { res.status(404).json({ error: err.message }); return; }
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid preset" });
  },
};
mountCommand(router, labelsApplyPresetCommand);

export default router;
