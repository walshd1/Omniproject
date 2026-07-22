/**
 * Consolidation-spec generator.
 *
 * Consolidation specs (which per-project measures to sum, the derived metrics, the row sort) are authored
 * as one JSON file per spec under lib/backend-catalogue/assets/consolidations/<id>.json — the roll-up shape
 * is DATA in the system catalogue, not a TypeScript constant. Validates each against
 * assets/schema/consolidation.schema.json and emits lib/backend-catalogue/src/consolidations.generated.ts,
 * the same generate-and-drift-guard pattern as gen-reports / gen-views / gen-mappings.
 *
 * Run: pnpm --filter @workspace/scripts run gen-consolidations
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "consolidations",
  schemaFile: "consolidation.schema.json",
  label: "consolidations",
  constName: "CONSOLIDATIONS_DATA",
  typeName: "ConsolidationSpec",
  typeModule: "./consolidation",
  noun: "Consolidation specs",
});
