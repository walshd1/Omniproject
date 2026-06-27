/*
 * SPDX-License-Identifier: LicenseRef-OmniProject-Premium
 * Premium feature — governed by licenses/PREMIUM.txt, NOT Apache-2.0.
 * Use in production requires a valid OmniProject commercial licence.
 */
import { backendCatalogue, getBackend } from "@workspace/backend-catalogue";
import { saveLabels } from "./labels";

/**
 * Per-vendor nomenclature presets (premium feature `labels`).
 *
 * A backend can declare how it names things (`nomenclature` in its vendor JSON,
 * e.g. Zendesk's "Ticket", ServiceNow's "Incident"). This exposes those as
 * one-click presets a customer used to that vendor's wording can adopt, instead
 * of re-typing each label by hand. Applying one just writes the preset through
 * the existing label-override path (so the same allow-list + entitlement apply).
 */

export interface NomenclaturePreset {
  backendId: string;
  label: string;
  /** Canonical label-catalogue key → this vendor's word. */
  terms: Record<string, string>;
}

/** Every backend that ships a non-empty nomenclature preset (respects the overlay). */
export function nomenclaturePresets(): NomenclaturePreset[] {
  return backendCatalogue()
    .map((b) => getBackend(b.id))
    .filter((b): b is NonNullable<typeof b> => !!b?.nomenclature && Object.keys(b.nomenclature).length > 0)
    .map((b) => ({ backendId: b.id, label: b.label, terms: b.nomenclature as Record<string, string> }));
}

/**
 * Apply a backend's nomenclature preset to the label overrides. Returns the saved
 * overrides, or null if no such preset exists. The caller enforces the entitlement;
 * `saveLabels` sanitises the terms (drops keys outside the label catalogue).
 */
export function applyNomenclaturePreset(backendId: string): Record<string, string> | null {
  const preset = nomenclaturePresets().find((p) => p.backendId === backendId);
  if (!preset) return null;
  return saveLabels(preset.terms);
}
