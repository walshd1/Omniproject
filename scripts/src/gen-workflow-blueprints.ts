/**
 * n8n example-blueprint generator + drift guard.
 *
 * `artifacts/n8n-blueprints/generated/*.json` are hand-committed EXAMPLE outputs
 * of `generateWorkflow()` (lib/backend-catalogue/src/workflow-generator.ts) — one per
 * backend, so operators can see what a generated workflow looks like without
 * running the app. `generateWorkflow` is pure and deterministic (no timestamps,
 * random ids, or ambient state — see its header comment), so for any backend
 * with a committed example this regenerates byte-identical output straight from
 * the live generator + the current `lib/backend-catalogue/vendors/backends/`
 * JSON. That makes staleness a plain `git diff`: this script overwrites the
 * examples in place, and the CI step (mirroring gen-vendors/gen-function-map)
 * fails the build if that produces a diff the author forgot to commit.
 *
 * Which backends get an example is driven by the files already in
 * `generated/` (filename `omniproject-<id>.json`) — add a new example by
 * dropping in any placeholder `omniproject-<id>.json` and rerunning this.
 *
 * Run: pnpm --filter @workspace/scripts run gen-n8n-blueprints
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBackend } from "../../lib/backend-catalogue/src/backend-catalogue";
import { generateWorkflow } from "../../lib/backend-catalogue/src/workflow-generator";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const GENERATED_DIR = path.join(ROOT, "artifacts/n8n-blueprints/generated");

const FILE_RE = /^omniproject-(.+)\.json$/;

const files = fs.readdirSync(GENERATED_DIR).filter((f) => FILE_RE.test(f)).sort();
if (files.length === 0) throw new Error(`no omniproject-<id>.json examples found under ${path.relative(ROOT, GENERATED_DIR)}`);

let written = 0;
for (const file of files) {
  const id = file.match(FILE_RE)![1]!;
  const manifest = getBackend(id);
  if (!manifest) throw new Error(`${file}: backend "${id}" is not in the catalogue (renamed/removed?) — delete the stale example or rename the file`);

  // Full read+write, deliberately: these committed examples document the COMPLETE contract
  // shape, not the Configurator's read-only-by-default download — see artifacts/n8n-blueprints/README.md.
  const workflow = generateWorkflow(manifest, {});
  const out = JSON.stringify(workflow, null, 2) + "\n";
  fs.writeFileSync(path.join(GENERATED_DIR, file), out);
  written++;
  console.log(`  → ${path.relative(ROOT, path.join(GENERATED_DIR, file))}`);
}

console.log(`n8n blueprints: ${written} example workflow(s) regenerated from the live generator.`);
