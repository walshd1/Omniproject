/**
 * Preset catalogue generator.
 *
 * Presets are authored as one JSON file per preset under
 * lib/backend-catalogue/assets/presets/<id>.json. Validates each against
 * assets/schema/preset.schema.json (via the shared gen-registry engine) and
 * emits lib/backend-catalogue/src/presets.generated.ts — the same
 * generate-and-drift-guard pattern as gen-methodologies. Making presets data is
 * what lets a new quick-load preset ship as JSON, not code.
 *
 * Run: pnpm --filter @workspace/scripts run gen-presets
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "presets",
  schemaFile: "preset.schema.json",
  label: "presets",
  constName: "PRESETS_DATA",
  typeName: "Preset",
  typeModule: "./preset-catalogue",
  noun: "Presets",
});
