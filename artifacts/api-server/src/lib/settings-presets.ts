import type { SettingsState } from "./settings";
import { settingsPresetCatalogue, getSettingsPreset as getCataloguePreset, type SettingsPreset as CataloguePreset } from "@workspace/backend-catalogue";

/**
 * Known-good settings blueprints for common customer archetypes — a starting point an operator LOADS in
 * the setup wizard / configurator and then tweaks, instead of configuring a bare deployment field by
 * field. Each preset is a small `Partial<SettingsState>` of the high-level posture knobs (deployment
 * profile, financial rigour, prioritisation emphasis, on-device vs external AI, lean vs full modules);
 * everything it doesn't set keeps the code defaults.
 *
 * The archetype DATA is authored as JSON under lib/backend-catalogue/assets/settings-presets/ (generated
 * catalogue), so a new blueprint ships as data, not code. Here we only re-type the generic `settings` payload
 * as `Partial<SettingsState>` at the api-server boundary (backend-catalogue can't depend on SettingsState).
 *
 * INVARIANT: every preset is a valid combination — it passes the cross-field constraint registry
 * (lib/settings-constraints) and the settings validator. A settings-presets test enforces this, so a
 * blueprint can never ship an illegal combo the constraint layer would reject. Presets deliberately set
 * no secrets/elevations (no capabilityStates/webhooks/AI keys) — AI stays "none" until the operator
 * supplies their own credentials.
 */
export interface SettingsPreset {
  id: string;
  label: string;
  /** Who this blueprint is for (shown as "For: …"). */
  audience: string;
  description: string;
  /** The posture this blueprint applies; merged over the current settings when loaded. */
  settings: Partial<SettingsState>;
}

/** Re-type a generated catalogue preset (generic `settings` object) as the api-server's `SettingsPreset`. */
function toSettingsPreset(p: CataloguePreset): SettingsPreset {
  return { id: p.id, label: p.label, audience: p.audience, description: p.description, settings: p.settings as Partial<SettingsState> };
}

/** The known-good settings blueprints, in display order. */
export function listSettingsPresets(): SettingsPreset[] {
  return settingsPresetCatalogue().map(toSettingsPreset);
}

/** One blueprint by id, or null. */
export function settingsPreset(id: string): SettingsPreset | null {
  const p = getCataloguePreset(id);
  return p ? toSettingsPreset(p) : null;
}
