/**
 * Project-template catalogue generator.
 *
 * Templates are authored as one JSON file per template under
 * lib/backend-catalogue/assets/templates/<id>.json. Validates each against
 * assets/schema/template.schema.json (via the shared gen-registry engine) and
 * emits lib/backend-catalogue/src/templates.generated.ts — the same
 * generate-and-drift-guard pattern as gen-presets. Making templates data is what
 * lets a new starter template ship as JSON, not code (and keeps the preset →
 * projectTemplate reference symmetric: both sides are now JSON).
 *
 * Run: pnpm --filter @workspace/scripts run gen-templates
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "templates",
  schemaFile: "template.schema.json",
  label: "templates",
  constName: "PROJECT_TEMPLATES_DATA",
  typeName: "ProjectTemplate",
  typeModule: "./template-catalogue",
  noun: "Project templates",
});
