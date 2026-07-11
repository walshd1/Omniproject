import { test } from "node:test";
import assert from "node:assert/strict";
import { type SpawnSyncReturns } from "node:child_process";
import { fileURLToPath } from "node:url";
import { spawnNode } from "./spawn-helper.test";

/**
 * send-cli is a scripts/CLI entrypoint (no exported surface), so it is covered by
 * spawning it as a subprocess and asserting exit code + output. The child inherits
 * NODE_V8_COVERAGE from c8, so its coverage merges into the report.
 */

const CLI = fileURLToPath(new URL("./send-cli.ts", import.meta.url));

/** Base env: force non-production and no real backend (→ demo broker). */
function baseEnv(extra: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...extra })) {
    if (v !== undefined) env[k] = v;
  }
  delete env["BROKER_URL"];
  delete env["BROKER_URLS"];
  delete env["BROKER_ENDPOINTS"];
  delete env["N8N_WEBHOOK_URL"];
  return env;
}

function runCli(args: string[], extra: Record<string, string | undefined> = {}): SpawnSyncReturns<string> {
  const env = baseEnv(extra);
  delete env["NODE_ENV"]; // non-prod by default
  return spawnNode(["--import", "tsx", CLI, ...args], env);
}

test("prints usage and exits 2 when no method is given", () => {
  const r = runCli([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: pnpm broker:send/);
});

test("is disabled under NODE_ENV=production", () => {
  const env = baseEnv();
  env["NODE_ENV"] = "production";
  const r = spawnNode(["--import", "tsx", CLI, "listProjects"], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /disabled in production/);
});

test("rejects an unknown broker method and lists the available ones", () => {
  const r = runCli(["bogusMethod"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown broker method: bogusMethod/);
  assert.match(r.stderr, /available: .*listProjects/);
});

test("rejects a non-JSON argument with a helpful hint", () => {
  const r = runCli(["listIssues", "notjson"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /argument #1 is not valid JSON/);
});

test("runs a read method and prints the result", () => {
  const r = runCli(["listProjects"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /result:/);
  assert.match(r.stdout, /proj-001/);
});

test("--twice reports an idempotent read as identical", () => {
  const r = runCli(["listProjects", "--twice"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /idempotent/);
});

test("reports a failed call and exits 1 when the method throws", () => {
  // writeIssue with a string where an input object is expected → throws in the call.
  const r = runCli(["writeIssue", '"delete"']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /call failed/);
});
