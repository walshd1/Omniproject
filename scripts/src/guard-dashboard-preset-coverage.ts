/**
 * Dashboard-preset-coverage guard — "every preset references only real widgets". Binds each widget
 * `type` placed by a preset (lib/backend-catalogue/assets/dashboard-presets/<id>.json) to a declared
 * widget in the widget catalogue (assets/widgets/<type>.json). A preset that names a widget that no
 * longer exists would render a graceful "Unknown widget" placeholder for the user — this guard catches
 * that drift at build time instead. The dashboard-preset analogue of guard-widget-coverage.
 *
 * Run: pnpm --filter @workspace/scripts run guard-dashboard-preset-coverage
 */
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT as ROOT } from "./lib/repo-root";
import { idsFromAssets } from "./lib/coverage";
import { reportGuard } from "./lib/guard-harness";


const widgetTypes = new Set(idsFromAssets(path.join(ROOT, "lib/backend-catalogue/assets/widgets")));
const presetsDir = path.join(ROOT, "lib/backend-catalogue/assets/dashboard-presets");
const presetFiles = fs.existsSync(presetsDir) ? fs.readdirSync(presetsDir).filter((f) => f.endsWith(".json")).sort() : [];

const errors: string[] = [];
let placed = 0;
for (const file of presetFiles) {
  const preset = JSON.parse(fs.readFileSync(path.join(presetsDir, file), "utf8")) as { widgets?: { type?: string }[] };
  const widgets = preset.widgets ?? [];
  if (widgets.length === 0) errors.push(`preset "${file}" places no widgets — a "what needs me today" screen needs at least one.`);
  for (const w of widgets) {
    placed++;
    if (!w.type || !widgetTypes.has(w.type)) {
      errors.push(`preset "${file}" references widget "${String(w.type)}" which no widget declares (add assets/widgets/${String(w.type)}.json or fix the preset).`);
    }
  }
}

reportGuard("dashboard-preset-coverage", {
  violations: errors,
  failHeadline: "dashboard-preset-coverage guard: a preset references a widget that isn't built.",
  help: "  Every preset widget `type` must be a real widget under assets/widgets/<type>.json.",
  okSummary: `${presetFiles.length} presets place ${placed} widgets, all real.`,
});
