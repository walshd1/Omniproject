/**
 * Form catalogue generator.
 *
 * Forms are authored as one JSON file per form under
 * lib/backend-catalogue/assets/forms/<id>.json. Validates each against
 * assets/schema/form.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/forms.generated.ts — the same generate-and-drift-guard
 * pattern as gen-reports/gen-screens. A form is a neutral JSON definition, so a
 * shipped form template is data, not code (matching reports/screens/views).
 *
 * Run: pnpm --filter @workspace/scripts run gen-forms
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "forms",
  schemaFile: "form.schema.json",
  label: "forms",
  constName: "FORMS_DATA",
  typeName: "FormDefinition",
  typeModule: "./form-catalogue",
  noun: "Forms",
});
