import { SETTINGS_PRESETS_DATA } from "./settings-presets.generated";

/**
 * SETTINGS-PRESET archetypes — known-good posture blueprints an operator loads in setup and then tweaks
 * (enterprise-pmo, growth-business, nonprofit, agency-services, regulated-selfhost, demo-trial). Authored as
 * JSON under assets/settings-presets/ and generated into `settings-presets.generated.ts`, so a new archetype
 * ships as data, not code — and the presets that reference a `settingsPreset` id resolve against real data.
 *
 * The `settings` payload is a partial settings posture kept as a generic object HERE (backend-catalogue must not
 * depend on api-server's SettingsState); the api-server re-types it as `Partial<SettingsState>` at its boundary
 * and a test validates every blueprint against the live cross-field constraint registry.
 */
export interface SettingsPreset {
  id: string;
  label: string;
  /** Who this blueprint is for (shown as "For: …"). */
  audience: string;
  description: string;
  /** Display order (ascending). */
  order: number;
  /** The posture this blueprint applies; merged over the current settings when loaded. */
  settings: Record<string, unknown>;
}

/** The shipped archetypes, ascending by `order` (stable). */
export const SETTINGS_PRESETS: SettingsPreset[] = [...SETTINGS_PRESETS_DATA].sort((a, b) => a.order - b.order);

/** The known-good settings blueprints, in display order. */
export function settingsPresetCatalogue(): SettingsPreset[] {
  return SETTINGS_PRESETS.map((p) => ({ ...p }));
}

/** One blueprint by id, or undefined. */
export function getSettingsPreset(id: string): SettingsPreset | undefined {
  return SETTINGS_PRESETS.find((p) => p.id === id);
}
