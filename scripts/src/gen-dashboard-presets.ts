/**
 * Dashboard-preset catalogue generator.
 *
 * Role-tailored "what needs me today" dashboards are authored as one JSON file per preset under
 * lib/backend-catalogue/assets/dashboard-presets/<id>.json. Validates each against
 * assets/schema/dashboard-preset.schema.json (via the shared gen-registry engine) and emits
 * lib/backend-catalogue/src/dashboard-presets.generated.ts — the same generate-and-drift-guard
 * pattern as gen-widgets / gen-personas. Making presets data is what lets a preset PACK ship as an
 * importable JSON bundle and keeps the single-file build clean.
 *
 * Run: pnpm --filter @workspace/scripts run gen-dashboard-presets
 */
import { runSingleAssetGenerator } from "./lib/gen-registry";

runSingleAssetGenerator({
  dir: "dashboard-presets",
  schemaFile: "dashboard-preset.schema.json",
  label: "dashboard-presets",
  constName: "DASHBOARD_PRESETS_DATA",
  typeName: "DashboardPreset",
  typeModule: "./dashboard-preset-catalogue",
  noun: "Presets",
});
