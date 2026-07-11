import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * End-to-end tests for the read-only `guard-*.ts` drift/consistency checks.
 *
 * Each guard walks the repo and exits non-zero if an invariant is violated;
 * against the committed tree they must all pass (exit 0) and write nothing.
 * Spawning them the way `pnpm run guard-*` does exercises their full body under
 * c8 via the inherited NODE_V8_COVERAGE env var.
 *
 * guard-broker-isolation is intentionally omitted: it can be slower and
 * overlaps with the dedicated verify-broker suite; the remaining guards give
 * broad, cheap coverage of the guard surface.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.resolve(HERE, "..");

function runGuard(scriptRel: string) {
  return spawnSync(process.execPath, ["--import", "tsx", path.join(SCRIPTS_DIR, scriptRel)], {
    cwd: SCRIPTS_DIR,
    encoding: "utf8",
    timeout: 120_000,
  });
}

const GUARDS = [
  "src/guard-superset.ts",
  "src/guard-interactive.ts",
  "src/guard-e2e-routes.ts",
  "src/guard-report-coverage.ts",
  "src/guard-widget-coverage.ts",
  "src/guard-dashboard-preset-coverage.ts",
  "src/guard-i18n-coverage.ts",
  "src/guard-broker-isolation.ts",
];

for (const script of GUARDS) {
  test(`${path.basename(script)}: passes against the committed tree`, () => {
    const r = runGuard(script);
    assert.equal(r.status, 0, `${script} exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  });
}
