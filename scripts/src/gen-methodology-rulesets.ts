/**
 * Methodology reference-ruleset catalogue generator.
 *
 * Reference rulesets are authored as one JSON file per methodology under
 * lib/backend-catalogue/assets/methodology-rulesets/<id>.json (id = methodology id).
 * Validates each against assets/schema/methodology-ruleset.schema.json (via the shared
 * gen-registry engine) and emits lib/backend-catalogue/src/methodology-rulesets.generated.ts —
 * the same generate-and-drift-guard pattern as gen-methodologies. The bundles are restrict-only
 * data the business-ruleset engine consumes; being data lets them ship inside a methodology PACK.
 *
 * Run: pnpm --filter @workspace/scripts run gen-methodology-rulesets
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "methodology-rulesets",
  schemaFile: "methodology-ruleset.schema.json",
  label: "methodology-rulesets",
  constName: "REFERENCE_RULESETS_DATA",
  typeName: "ReferenceRulesetData",
  typeModule: "./methodology-rulesets",
  noun: "Reference rulesets",
});
