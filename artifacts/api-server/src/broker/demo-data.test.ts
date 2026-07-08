import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnNode } from "./spawn-helper.test";
import {
  sampleActivity,
  sampleNotifications,
  getDemoState,
  loadDemoState,
  resetDemoDataToSeed,
  shouldAutoResetDemo,
  demoResetIntervalMinutes,
  SAMPLE_PROJECTS,
} from "./demo-data";
import type { Row } from "./types";

const MODULE = fileURLToPath(new URL("./demo-data.ts", import.meta.url));

/** Run a driver that imports demo-data in a FRESH process (module-level, env-gated
 *  code only runs at import). Returns parsed stdout JSON. Child inherits
 *  NODE_V8_COVERAGE from c8, so its coverage merges into the report. */
function runDriver(code: string, env: Record<string, string | undefined>): unknown {
  const childEnv: Record<string, string> = { MOD: MODULE };
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) childEnv[k] = v;
  }
  const res = spawnNode(["--import", "tsx", "-e", code], childEnv);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout.trim());
}

// --- Pure exported helpers (in-process) ----------------------------------------

test("sampleActivity / sampleNotifications return canned demo rows", () => {
  const acts = sampleActivity();
  assert.ok(acts.length >= 1);
  assert.ok(acts.every((r) => typeof r["id"] === "string"));
  const ntfs = sampleNotifications();
  assert.ok(ntfs.length >= 1);
  assert.ok(ntfs.some((n) => n["read"] === false));
});

test("demoResetIntervalMinutes parses DEMO_RESET_MINUTES with a sane default", () => {
  const saved = process.env["DEMO_RESET_MINUTES"];
  try {
    delete process.env["DEMO_RESET_MINUTES"];
    assert.equal(demoResetIntervalMinutes(), 60, "unset → default 60");
    process.env["DEMO_RESET_MINUTES"] = "0";
    assert.equal(demoResetIntervalMinutes(), 0, "0 disables");
    process.env["DEMO_RESET_MINUTES"] = "15";
    assert.equal(demoResetIntervalMinutes(), 15);
    process.env["DEMO_RESET_MINUTES"] = "-5";
    assert.equal(demoResetIntervalMinutes(), 60, "negative → default");
    process.env["DEMO_RESET_MINUTES"] = "not-a-number";
    assert.equal(demoResetIntervalMinutes(), 60, "non-numeric → default");
  } finally {
    if (saved === undefined) delete process.env["DEMO_RESET_MINUTES"];
    else process.env["DEMO_RESET_MINUTES"] = saved;
  }
});

test("shouldAutoResetDemo is true in demo mode with no backend and no dev-persist", () => {
  // In the test process neither BROKER_URL nor DEV_PERSIST_FILE is set.
  assert.equal(shouldAutoResetDemo(), true);
});

test("loadDemoState replaces the dataset in place; resetDemoDataToSeed restores the boot seed", () => {
  const bootLen = SAMPLE_PROJECTS.length;
  const replacement = { projects: [{ id: "tmp-1", name: "Temp" } as Row], issues: {}, raid: {} };
  loadDemoState(replacement);
  assert.equal(SAMPLE_PROJECTS.length, 1, "arrays mutated in place");
  assert.equal(getDemoState().projects[0]!["id"], "tmp-1");

  resetDemoDataToSeed();
  assert.equal(SAMPLE_PROJECTS.length, bootLen, "restored to the pristine boot seed");
  // The pristine snapshot must not be aliased by a later mutation.
  loadDemoState({ projects: [], issues: {}, raid: {} });
  resetDemoDataToSeed();
  assert.equal(SAMPLE_PROJECTS.length, bootLen);
});

// --- DEMO_SCALE_* seeding (module-level; needs a fresh process) ----------------

test("DEMO_SCALE_PROJECTS seeds N extra generated projects with consistent counts", () => {
  const out = runDriver(
    "import(process.env.MOD).then(m => {" +
      "const gen = m.SAMPLE_PROJECTS.filter(p => String(p.id).startsWith('gen-'));" +
      "const first = gen[0];" +
      "const issues = m.SAMPLE_ISSUES[first.id];" +
      "console.log(JSON.stringify({ total: m.SAMPLE_PROJECTS.length, genCount: gen.length, issueCount: first.issueCount, actualIssues: issues.length }));" +
      "}).catch(e => { console.error(e); process.exit(1); })",
    { DEMO_SCALE_PROJECTS: "3", DEMO_SCALE_ISSUES: "4" },
  ) as { total: number; genCount: number; issueCount: number; actualIssues: number };

  assert.equal(out.genCount, 3, "three generated projects");
  assert.ok(out.total >= 7, "generated projects added to the four base ones");
  assert.equal(out.actualIssues, 4, "each generated project has DEMO_SCALE_ISSUES issues");
  assert.equal(out.issueCount, out.actualIssues, "issueCount reconciled with the seeded issues");
});

// --- Stateful dev mode: boot hydration + persist (module-level; fresh process) --

test("with DEV_PERSIST_FILE set, the dataset hydrates from disk on boot and persists back", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-demo-persist-"));
  const stateFile = join(dir, "state.json");
  writeFileSync(
    stateFile,
    JSON.stringify({ projects: [{ id: "hydrated-proj", name: "Hydrated" }], issues: {}, raid: {} }),
  );

  const out = runDriver(
    "import(process.env.MOD).then(m => {" +
      "const before = m.SAMPLE_PROJECTS.map(p => p.id);" +
      "m.persistDemoState();" +
      "console.log(JSON.stringify({ before }));" +
      "}).catch(e => { console.error(e); process.exit(1); })",
    {
      DEV_PERSIST_FILE: stateFile,
      NODE_ENV: "development",
      // Ensure no backend is configured so the boot hydrate branch runs.
      BROKER_URL: undefined,
      BROKER_URLS: undefined,
      BROKER_ENDPOINTS: undefined,
      N8N_WEBHOOK_URL: undefined,
    },
  ) as { before: string[] };

  assert.deepEqual(out.before, ["hydrated-proj"], "boot hydrate replaced the seed with the persisted state");
  // persistDemoState wrote the (hydrated) state back to disk.
  const persisted = JSON.parse(readFileSync(stateFile, "utf8")) as { projects: { id: string }[] };
  assert.equal(persisted.projects[0]!.id, "hydrated-proj");
});
