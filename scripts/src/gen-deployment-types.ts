/**
 * Deployment-type catalogue generator.
 *
 * Deployment types are authored as one JSON file per type under
 * lib/backend-catalogue/assets/deployment-types/<id>.json. Validates each against
 * assets/schema/deployment-type.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/deployment-types.generated.ts — the same generate-and-drift-guard pattern as
 * gen-methodologies. Being data is what lets a deployment type ship as an editable on-ramp archetype.
 *
 * Run: pnpm --filter @workspace/scripts run gen-deployment-types
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "deployment-types",
  schemaFile: "deployment-type.schema.json",
  label: "deployment-types",
  constName: "DEPLOYMENT_TYPES_DATA",
  typeName: "DeploymentType",
  typeModule: "./deployment-type-catalogue",
  noun: "Deployment types",
});
