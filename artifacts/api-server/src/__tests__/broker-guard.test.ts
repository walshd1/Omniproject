import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Architecture guard — the boundary invariant detector.
 *
 * The point of the broker seam is that the gateway is structurally incapable of
 * knowing the broker is n8n. These tests FAIL CI if that ever stops being true,
 * so a future shortcut can't silently re-weld the data path to n8n. See
 * docs/BROKER.md for the full boundary invariants.
 *
 * Two assertions:
 *   A. The domain / data-path modules contain ZERO n8n tokens (prose included) —
 *      these are the files the seam exists to protect.
 *   B. The legacy n8n call API never appears OUTSIDE the broker adapter.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

// ── A. The data path must be entirely n8n-free ──────────────────────────────────
// These modules sit ABOVE the seam and consume project/issue/portfolio/report
// data. None of them may name, import, or even mention n8n — that's the whole
// point of the boundary. (The n8n specifics live in src/broker/reference-broker/.)
const PRISTINE = [
  "lib/data.ts",
  "lib/capabilities.ts",
  "lib/currency.ts",
  "lib/programmes.ts",
  "lib/metrics.ts",
  "routes/projects.ts",
  "routes/portfolio.ts",
  "routes/programmes.ts",
  "routes/export.ts",
  "routes/odata.ts",
  "routes/integrations.ts",
];

test("guard: the data-path modules contain no n8n references", () => {
  const offenders: string[] = [];
  for (const rel of PRISTINE) {
    if (/n8n/i.test(read(rel))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `These data-path modules must be n8n-free (move n8n specifics into src/broker/reference-broker/): ${offenders.join(", ")}`);
});

// ── B. The legacy n8n call API must not leak outside the adapter ────────────────
// If any of these reappear above the seam, a caller has bypassed the Broker
// interface and re-coupled to n8n. They are allowed ONLY under src/broker/.
const FORBIDDEN_API = /\b(callBroker|BROKER_ENV_CONFIGURED|AdapterResult|authHeaderFromReq|userContextFromReq)\b/;

test("guard: the n8n call API does not appear outside src/broker", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel.startsWith("broker/") || rel.startsWith("__tests__/")) continue;
    if (FORBIDDEN_API.test(fs.readFileSync(file, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `The n8n call API must stay inside src/broker/ (use the Broker interface instead): ${offenders.join(", ")}`);
});

// ── C. NOTHING above the seam may import the reference broker adapter — zero exceptions ──
// Importing src/broker/reference-broker directly is the adapter's own concern. The command
// edges (/broker/command, the raw escape hatch) go through the neutral
// `brokerCommand()` seam helper, so the allowlist is empty: not one file above the
// seam names the adapter.
const ADAPTER_IMPORT = /from\s+["'][^"']*\/broker\/reference-broker["']/;
const ADAPTER_IMPORT_ALLOWED = new Set<string>(); // intentionally empty — keep it that way

test("guard: nothing above the seam imports the reference broker adapter directly", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel.startsWith("broker/") || rel.startsWith("__tests__/") || ADAPTER_IMPORT_ALLOWED.has(rel)) continue;
    if (ADAPTER_IMPORT.test(fs.readFileSync(file, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `Import the Broker interface (../broker) or brokerCommand(), not the reference broker adapter: ${offenders.join(", ")}`);
});
