/**
 * Report catalogue generator.
 *
 * Reports are authored as one JSON file per report under
 * lib/backend-catalogue/assets/reports/<id>.json. Validates each against
 * assets/schema/report.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/reports.generated.ts — the same generate-and-drift-guard
 * pattern as gen-views.
 *
 * Run: pnpm --filter @workspace/scripts run gen-reports
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "reports",
  schemaFile: "report.schema.json",
  label: "reports",
  constName: "REPORTS_DATA",
  typeName: "ReportDefinition",
  typeModule: "./report-catalogue",
  noun: "Reports",
});
