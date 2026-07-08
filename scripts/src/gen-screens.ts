/**
 * Screen catalogue generator.
 *
 * Screens are authored as one JSON file per screen under
 * lib/backend-catalogue/assets/screens/<id>.json. Validates each against
 * assets/schema/screen.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/screens.generated.ts — the same generate-and-drift-guard
 * pattern as gen-views.
 *
 * Run: pnpm --filter @workspace/scripts run gen-screens
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "screens",
  schemaFile: "screen.schema.json",
  label: "screens",
  constName: "SCREENS_DATA",
  typeName: "ScreenDefinition",
  typeModule: "./screen-catalogue",
  noun: "Screens",
});
