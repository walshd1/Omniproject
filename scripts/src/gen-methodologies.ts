/**
 * Methodology catalogue generator.
 *
 * Methodologies are authored as one JSON file per methodology under
 * lib/backend-catalogue/assets/methodologies/<id>.json. Validates each against
 * assets/schema/methodology.schema.json (via the shared gen-registry engine) and
 * emits lib/backend-catalogue/src/methodologies.generated.ts — the same
 * generate-and-drift-guard pattern as gen-views. Making methodologies data is what
 * lets a methodology PACK ship as an importable JSON bundle.
 *
 * Run: pnpm --filter @workspace/scripts run gen-methodologies
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "methodologies",
  schemaFile: "methodology.schema.json",
  label: "methodologies",
  constName: "METHODOLOGIES_DATA",
  typeName: "MethodologyDefinition",
  typeModule: "./methodology-catalogue",
  noun: "Methodologies",
});
