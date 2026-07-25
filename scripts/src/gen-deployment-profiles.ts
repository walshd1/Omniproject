/**
 * Deployment-profile catalogue generator.
 *
 * Deployment profiles are authored as one JSON file per profile under
 * lib/backend-catalogue/assets/deployment-profiles/<id>.json. Validates each against
 * assets/schema/deployment-profile.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/deployment-profiles.generated.ts — the same generate-and-drift-guard pattern as
 * gen-deployment-types. Being data is what lets a new deployment-profile TYPE ship as editable JSON, no code
 * change (DESIGN-PRINCIPLES §2 — data is JSON; code is code).
 *
 * Run: pnpm --filter @workspace/scripts run gen-deployment-profiles
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "deployment-profiles",
  schemaFile: "deployment-profile.schema.json",
  label: "deployment-profiles",
  constName: "DEPLOYMENT_PROFILES_DATA",
  typeName: "ProfilePosture",
  typeModule: "./deployment-profile-catalogue",
  noun: "Deployment profiles",
});
