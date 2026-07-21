import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the `gen-*.ts` codegen entrypoints.
 *
 * Each generator runs at import time and writes checked-in artefacts (mostly
 * `*.generated.ts` under lib/backend-catalogue/src, plus a few docs). We can't
 * import them (that would fire the side effects into the c8 worker's cwd with an
 * unpredictable env), so instead we spawn each one as a real subprocess exactly
 * the way `pnpm run gen-*` does — `node --import tsx <script>`.
 *
 * Two properties are asserted per generator:
 *   1. it exits 0, and
 *   2. it is IDEMPOTENT — after running, the artefacts it owns show no git drift.
 * Property (2) is what makes this safe to run in CI/coverage: a passing test
 * leaves the working tree exactly as it found it. If a generator ever drifts,
 * the test fails loudly instead of silently dirtying the repo.
 *
 * Because coverage runs under c8, the inherited NODE_V8_COVERAGE env var means
 * the subprocesses' execution is folded back into the coverage report.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, ".."); // .../scripts
const ROOT = path.resolve(SCRIPTS_DIR, ".."); // repo root

/** Run a script the way its pnpm alias does; returns the process result. */
function runGen(scriptRel: string) {
  return spawnSync(process.execPath, ["--import", "tsx", path.join(SCRIPTS_DIR, scriptRel)], {
    cwd: SCRIPTS_DIR,
    encoding: "utf8",
    // env is inherited (default) so NODE_V8_COVERAGE flows into the subprocess.
    timeout: 120_000,
  });
}

/** True when none of `files` (paths relative to repo root) have git drift. */
function isClean(files: string[]): { clean: boolean; detail: string } {
  const r = spawnSync("git", ["diff", "--", ...files], { cwd: ROOT, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain", "--", ...files], { cwd: ROOT, encoding: "utf8" });
  const detail = (r.stdout || "") + (status.stdout || "");
  return { clean: detail.trim() === "", detail };
}

interface GenCase {
  name: string;
  script: string;
  /** Checked-in artefacts the generator owns, relative to repo root. */
  outputs: string[];
}

const BC = "lib/backend-catalogue/src";

const CASES: GenCase[] = [
  {
    name: "gen-contract",
    script: "src/gen-contract.ts",
    outputs: [
      "docs/contract/broker.v1.schema.json",
      "docs/CONTRACT.md",
      "artifacts/api-server/src/broker/contract.schema.generated.ts",
    ],
  },
  { name: "gen-openapi", script: "src/gen-openapi-bundle.ts", outputs: ["artifacts/api-server/src/lib/openapi.generated.ts"] },
  { name: "gen-function-map", script: "src/gen-function-map.ts", outputs: ["docs/FUNCTION-MAP.md"] },
  { name: "gen-api-reference", script: "src/gen-api-reference.ts", outputs: ["docs/API-REFERENCE.md", "artifacts/api-server/src/lib/api-portal.generated.ts"] },
  {
    name: "gen-vendors",
    script: "src/gen-vendors.ts",
    outputs: [`${BC}/vendors.generated.ts`, `${BC}/vendor-schemas.generated.ts`],
  },
  { name: "gen-workflow-blueprints", script: "src/gen-workflow-blueprints.ts", outputs: ["artifacts/n8n-blueprints/generated"] },
  { name: "gen-views", script: "src/gen-views.ts", outputs: [`${BC}/views.generated.ts`] },
  { name: "gen-notification-routes", script: "src/gen-notification-routes.ts", outputs: [`${BC}/notification-routes.generated.ts`] },
  { name: "gen-fields", script: "src/gen-fields.ts", outputs: [`${BC}/fields.generated.ts`] },
  { name: "gen-reports", script: "src/gen-reports.ts", outputs: [`${BC}/reports.generated.ts`] },
  { name: "gen-widgets", script: "src/gen-widgets.ts", outputs: [`${BC}/widgets.generated.ts`] },
  { name: "gen-dashboard-presets", script: "src/gen-dashboard-presets.ts", outputs: [`${BC}/dashboard-presets.generated.ts`] },
  { name: "gen-screens", script: "src/gen-screens.ts", outputs: [`${BC}/screens.generated.ts`] },
  { name: "gen-methodologies", script: "src/gen-methodologies.ts", outputs: [`${BC}/methodologies.generated.ts`] },
  { name: "gen-personas", script: "src/gen-personas.ts", outputs: [`${BC}/personas.generated.ts`] },
  { name: "gen-methodology-rulesets", script: "src/gen-methodology-rulesets.ts", outputs: [`${BC}/methodology-rulesets.generated.ts`] },
  { name: "gen-consolidations", script: "src/gen-consolidations.ts", outputs: [`${BC}/consolidations.generated.ts`] },
  { name: "gen-work-vocabulary", script: "src/gen-work-vocabulary.ts", outputs: [`${BC}/work-vocabulary.generated.ts`] },
  { name: "gen-task-vocabulary", script: "src/gen-task-vocabulary.ts", outputs: [`${BC}/task-vocabulary.generated.ts`] },
  { name: "gen-priority-weights", script: "src/gen-priority-weights.ts", outputs: [`${BC}/priority-weights.generated.ts`] },
];

for (const c of CASES) {
  test(`${c.name}: runs cleanly and is idempotent`, () => {
    // Guard: the artefacts must be clean going in, or an idempotence assertion
    // would be meaningless (we'd be blaming this generator for pre-existing drift).
    const before = isClean(c.outputs);
    assert.equal(before.clean, true, `pre-existing drift before running ${c.name}:\n${before.detail}`);

    const r = runGen(c.script);
    assert.equal(r.status, 0, `${c.name} exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

    const after = isClean(c.outputs);
    assert.equal(after.clean, true, `${c.name} is NOT idempotent — artefacts drifted:\n${after.detail}`);
  });
}
