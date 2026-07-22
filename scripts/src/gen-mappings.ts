/**
 * Mapping catalogue generator.
 *
 * CORE field mappings are authored as one JSON file per slot under
 * lib/backend-catalogue/assets/mappings/<id>.json (roadmap §4.6 — mappings are DATA
 * in the system store, not TypeScript constants). Validates each against
 * assets/schema/mapping.schema.json and emits lib/backend-catalogue/src/mappings.generated.ts
 * — the same generate-and-drift-guard pattern as gen-reports / gen-views.
 *
 * Run: pnpm --filter @workspace/scripts run gen-mappings
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "mappings",
  schemaFile: "mapping.schema.json",
  label: "mappings",
  constName: "MAPPINGS_DATA",
  typeName: "MappingDef",
  typeModule: "./mapping-catalogue",
  noun: "Mappings",
});
