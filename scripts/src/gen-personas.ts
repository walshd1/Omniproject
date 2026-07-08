/**
 * Copilot persona catalogue generator.
 *
 * Personas are authored as one JSON file per persona under
 * lib/backend-catalogue/assets/personas/<id>.json. Validates each against
 * assets/schema/persona.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/personas.generated.ts — the same generate-and-drift-guard
 * pattern as gen-methodologies. Making personas data is what lets a persona PACK ship as
 * an importable JSON bundle (and keeps the gateway's single-file build clean).
 *
 * Run: pnpm --filter @workspace/scripts run gen-personas
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "personas",
  schemaFile: "persona.schema.json",
  label: "personas",
  constName: "PERSONAS_DATA",
  typeName: "Persona",
  typeModule: "./persona-catalogue",
  noun: "Personas",
});
