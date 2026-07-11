/**
 * Widget catalogue generator.
 *
 * Dashboard widgets are authored as one JSON file per widget under
 * lib/backend-catalogue/assets/widgets/<type>.json. Validates each against
 * assets/schema/widget.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/widgets.generated.ts — the same generate-and-drift-guard
 * pattern as gen-reports / gen-views.
 *
 * Run: pnpm --filter @workspace/scripts run gen-widgets
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "widgets",
  schemaFile: "widget.schema.json",
  label: "widgets",
  constName: "WIDGETS_DATA",
  typeName: "WidgetDefinition",
  typeModule: "./widget-catalogue",
  idField: "type",
  noun: "Widgets",
});
