import { test } from "node:test";
import assert from "node:assert/strict";
import { type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnNode } from "./spawn-helper.test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * replay-cli is a scripts/CLI entrypoint. Covered by spawning it against a small
 * tape fixture and asserting exit code + output; the child's coverage merges into
 * the c8 report via the inherited NODE_V8_COVERAGE.
 */

const CLI = fileURLToPath(new URL("./replay-cli.ts", import.meta.url));

function makeTape(): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-replay-cli-"));
  const tape = join(dir, "tape.jsonl");
  const lines = [
    { seq: 0, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [{ id: "p1", name: "X" }], ms: 1, ok: true },
    { seq: 1, ts: "t", plane: "broker", method: "createProject", args: [{ sub: "u" }, { name: "N" }], result: { id: "p2" }, ms: 1, ok: true },
  ];
  writeFileSync(tape, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return tape;
}

function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["BROKER_URL", "BROKER_URLS", "BROKER_ENDPOINTS", "N8N_WEBHOOK_URL", "NODE_ENV"]) delete env[k];
  return env;
}

function runCli(args: string[], prod = false): SpawnSyncReturns<string> {
  const env = baseEnv();
  if (prod) env["NODE_ENV"] = "production";
  return spawnNode(["--import", "tsx", CLI, ...args], env);
}

test("prints usage and exits 2 with no tape path", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: pnpm broker:replay/);
});

test("is disabled under NODE_ENV=production", () => {
  const r = runCli([makeTape()], true);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /disabled in production/);
});

test("summarises a tape by plane.method", () => {
  const r = runCli([makeTape()]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /tape: 2 exchanges across 2 plane\.methods/);
  assert.match(r.stdout, /broker\.listProjects/);
});

test("--serve replays a recorded call and prints its result", () => {
  const r = runCli([makeTape(), "--serve", "listProjects"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"id": "p1"/);
});

test("--serve without a method name exits 2", () => {
  const r = runCli([makeTape(), "--serve"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--serve needs a method name/);
});

test("--redrive --dry-run lists steps without calling and skips writes read-only", () => {
  const r = runCli([makeTape(), "--redrive", "--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /re-drive: 0 ran/);
  assert.match(r.stdout, /listProjects/);
  assert.match(r.stdout, /createProject/);
});

test("--redrive drives the live broker and prints per-step marks (exit 1 on divergence)", () => {
  // Live demo broker returns the real projects, which differ from the recorded
  // single-project result → the read step diverges; the write is skipped read-only.
  const r = runCli([makeTape(), "--redrive"]);
  assert.equal(r.status, 1, "diverged/failed → exit 1");
  assert.match(r.stdout, /re-drive: \d+ ran/);
  assert.match(r.stdout, /listProjects/);
  // The write method appears as a skipped step.
  assert.match(r.stdout, /createProject/);
});
