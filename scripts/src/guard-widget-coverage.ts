/**
 * Widget-coverage guard — "every declared dashboard widget is built". Binds each widget in the catalogue
 * (lib/backend-catalogue/assets/widgets/<type>.json) to a registered renderer in the SPA widget registry
 * (components/dashboard/widgets WIDGET_COMPONENTS), and flags any orphan renderer that no widget declares.
 * The dashboard analogue of guard-report-coverage — declared == built, both ways.
 *
 * Run: pnpm --filter @workspace/scripts run guard-widget-coverage
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idsFromAssets } from "./lib/coverage";
import { reportGuard } from "./lib/guard-harness";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const widgetTypes = idsFromAssets(path.join(ROOT, "lib/backend-catalogue/assets/widgets"));
const registryFile = path.join(ROOT, "artifacts/omniproject/src/components/dashboard/widgets.tsx");
const src = fs.readFileSync(registryFile, "utf8");

// Pull the keys out of the WIDGET_COMPONENTS record literal.
const block = src.match(/WIDGET_COMPONENTS[^{]*\{([^}]*)\}/s);
const registered = new Set(
  block ? [...block[1]!.matchAll(/(\w+)\s*:/g)].map((m) => m[1]!) : [],
);

const errors: string[] = [];
for (const type of widgetTypes) {
  if (!registered.has(type)) errors.push(`widget "${type}" has no renderer in WIDGET_COMPONENTS (components/dashboard/widgets.tsx)`);
}
for (const type of registered) {
  if (!widgetTypes.includes(type)) errors.push(`renderer "${type}" is registered but no widget declares it (add assets/widgets/${type}.json or remove the renderer)`);
}

reportGuard("widget-coverage", {
  violations: errors,
  failHeadline: "widget-coverage guard: a declared widget is not built, or a renderer is orphaned.",
  help: "  Author the widget JSON under assets/widgets/<type>.json AND register its renderer in WIDGET_COMPONENTS.",
  okSummary: `all ${widgetTypes.length} declared widgets are registered (and no orphan renderers).`,
});
