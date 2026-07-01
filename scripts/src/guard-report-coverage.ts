/**
 * Coverage guard — "every declared report is built". Binds each entry in the report catalogue
 * (lib/backend-catalogue/assets/reports/<id>.json) to a real, page-wired, tested implementation, so a
 * catalogue entry can never again drift away from its renderer (the gap the maturity audit found, where
 * six reports were offered but rendered nothing). A new report fails CI until it's wired + tested.
 *
 * This is the hand-wired-plane analogue of the data-driven drift guards: screens/views/methodologies
 * render through generic renderers (declared == built by construction), so only the bespoke report
 * components need this binding. Adding another hand-wired plane is one more `checkCoverage(...)` call.
 *
 * Run: pnpm --filter @workspace/scripts run guard-report-coverage
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCoverage, fsProbes, idsFromAssets, type Impl } from "./lib/coverage";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

const REPORTS_DIR = path.join(ROOT, "lib/backend-catalogue/assets/reports");

/**
 * How each report id is realised is now part of its JSON definition (`renderer`), not a hand-kept map
 * here — moving the binding into the same file as the rest of the report def. Each report resolves to:
 *  - `renderer.engine: "builtin"` + `component` → a bespoke `components/reports/<component>.tsx` wired
 *    into the Reports page (the registered renderer), or
 *  - `renderer.surfacedVia` → the report is reached through another plane (e.g. a board view), a
 *    documented exception rather than a Reports-page card, or
 *  - `renderer.engine: "custom"` → the generic no-code engine renders it (declared == built).
 */
type Renderer = { engine?: string; component?: string; surfacedVia?: string; reason?: string };

function implFromRenderer(id: string): Impl {
  const j = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, `${id}.json`), "utf8")) as { renderer?: Renderer };
  const r = j.renderer;
  if (!r) throw new Error(`report "${id}" has no renderer in its JSON definition`);
  if (r.surfacedVia) return { surfacedVia: r.surfacedVia, reason: r.reason ?? `surfaced via ${r.surfacedVia}` };
  // engine "custom" renders through the generic engine — declared == built, no bespoke component needed.
  if (r.engine === "custom") return { surfacedVia: "custom-engine", reason: "rendered by the no-code report engine (CustomReport)" };
  if (!r.component) throw new Error(`report "${id}" renderer.engine=builtin but has no component`);
  return r.component;
}

const reportIds = idsFromAssets(REPORTS_DIR);
const REPORT_IMPL: Record<string, Impl> = Object.fromEntries(reportIds.map((id) => [id, implFromRenderer(id)]));
const probes = fsProbes(
  path.join(ROOT, "artifacts/omniproject/src/components/reports"),
  path.join(ROOT, "artifacts/omniproject/src/pages/Reports.tsx"),
);

const result = checkCoverage("reports", reportIds, REPORT_IMPL, probes);

if (!result.ok) {
  console.error("report-coverage guard: a declared report is not built/wired/tested.\n");
  for (const e of result.errors) console.error(`  - ${e}`);
  console.error("\n  Implement the report on the report primitives, wire it into Reports.tsx, add a test, and set its `renderer` in the report JSON.");
  process.exit(1);
}
console.log(`report-coverage guard: OK — all ${reportIds.length} declared reports are built, wired and tested (bindings from each report's JSON renderer).`);
