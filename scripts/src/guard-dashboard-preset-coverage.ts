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
import { fileURLToPath } from "node:url";
import { idsFromAssets } from "./lib/coverage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

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

if (errors.length) {
  console.error("dashboard-preset-coverage guard: a preset references a widget that isn't built.\n");
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\n  Every preset widget `type` must be a real widget under assets/widgets/<type>.json.");
  process.exit(1);
}
console.log(`dashboard-preset-coverage guard: OK — ${presetFiles.length} presets place ${placed} widgets, all real.`);
