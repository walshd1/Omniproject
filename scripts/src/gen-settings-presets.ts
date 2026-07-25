/**
 * Settings-preset (archetype blueprint) generator.
 *
 * Archetypes are authored as one JSON file per preset under
 * lib/backend-catalogue/assets/settings-presets/<id>.json. Validates each against
 * assets/schema/settings-preset.schema.json (via the shared gen-registry engine)
 * and emits lib/backend-catalogue/src/settings-presets.generated.ts — the same
 * generate-and-drift-guard pattern as gen-presets. The api-server re-types the
 * `settings` payload as Partial<SettingsState> and validates each combo against
 * the live cross-field constraint registry.
 *
 * Run: pnpm --filter @workspace/scripts run gen-settings-presets
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "settings-presets",
  schemaFile: "settings-preset.schema.json",
  label: "settings-presets",
  constName: "SETTINGS_PRESETS_DATA",
  typeName: "SettingsPreset",
  typeModule: "./settings-preset-catalogue",
  noun: "Settings presets",
});
