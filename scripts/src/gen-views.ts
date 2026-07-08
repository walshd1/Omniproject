/**
 * View catalogue generator.
 *
 * Views are authored as one JSON file per view under
 * lib/backend-catalogue/assets/views/<id>.json. Validates each against
 * assets/schema/view.schema.json (via the shared gen-registry engine) and emits
 * the portable, type-checked lib/backend-catalogue/src/views.generated.ts — the
 * same generate-and-drift-guard pattern as gen-vendors.
 *
 * Run: pnpm --filter @workspace/scripts run gen-views
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "views",
  schemaFile: "view.schema.json",
  label: "views",
  constName: "VIEWS_DATA",
  typeName: "ViewDefinition",
  typeModule: "./view-catalogue",
  noun: "Views",
});
