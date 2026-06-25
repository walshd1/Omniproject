import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Deploy-artifact guard — the same idea as broker-guard.test.ts, applied to the
 * deployment files. These FAIL CI when a deploy artifact drifts away from the
 * app's current contract, which is exactly how N8N_WEBHOOK_URL silently rotted
 * (the app renamed it to BROKER_URL in 0.2.0; the compose/k8s files kept the old
 * name and would have run in demo mode). See CHANGELOG / docs/BROKER.md.
 *
 *   A. Removed env names never reappear in deploy files (history comments aside).
 *   B. Every deploy file wires the broker under its current name (BROKER_URL).
 *   C. .env.example documents every required ${VAR:?} the compose files demand,
 *      so the example can't silently fall behind what the stack won't boot without.
 */

// artifacts/api-server/src/__tests__ → repo root
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const COMPOSE_FILES = ["docker-compose.standalone.yml", "docker-compose.enterprise.yml"];
const DEPLOY_FILES = [...COMPOSE_FILES, "k8s-enterprise-manifest.yaml"];

// ── A. Removed env names must not resurface (one allowed history breadcrumb) ───
const FORBIDDEN_ENV = /\bN8N_WEBHOOK_URL\b/;

test("deploy guard: removed env names do not reappear (rename to BROKER_URL)", () => {
  const offenders: string[] = [];
  for (const rel of DEPLOY_FILES) {
    read(rel).split("\n").forEach((line, i) => {
      if (!FORBIDDEN_ENV.test(line)) return;
      if (/#.*\bwas\s+N8N_WEBHOOK_URL\b/.test(line)) return; // allowed "was N8N_WEBHOOK_URL" comment
      offenders.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], `Removed env N8N_WEBHOOK_URL resurfaced: ${offenders.join(", ")}`);
});

// ── B. Every deploy file must wire the broker under its current name ───────────
test("deploy guard: every deploy file sets BROKER_URL", () => {
  const missing = DEPLOY_FILES.filter((rel) => !/\bBROKER_URL\b/.test(read(rel)));
  assert.deepEqual(missing, [], `Deploy files no longer set BROKER_URL: ${missing.join(", ")}`);
});

// ── C. .env.example documents every required ${VAR:?} the compose files demand ─
function requiredVars(yml: string): string[] {
  return [...new Set([...yml.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => m[1]!))];
}

test("deploy guard: every required ${VAR:?} in compose is listed in .env.example", () => {
  const env = read(".env.example");
  const offenders: string[] = [];
  for (const rel of COMPOSE_FILES) {
    for (const v of requiredVars(read(rel))) {
      // .env.example lists these commented out, e.g. "# SESSION_SECRET="
      if (!new RegExp(`(^|\\n)\\s*#?\\s*${v}=`).test(env)) offenders.push(`${rel} -> ${v}`);
    }
  }
  assert.deepEqual(offenders, [], `Required compose vars missing from .env.example: ${offenders.join(", ")}`);
});
