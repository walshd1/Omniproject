import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Vocabulary guard — the canonical-vocabulary boundary detector.
 *
 * Sibling to broker-guard: where that stops a vendor *name* leaking above the
 * seam, this stops a canonical *value vocabulary* being re-derived anywhere but
 * its one home (broker/vocabulary.ts). The RAG triple, the `ragFor` policy and the
 * bare `=== "done"` completion test are load-bearing meanings; if they appear
 * inline elsewhere a backend with a different vocabulary silently mis-classifies.
 * Everything must import from broker/vocabulary instead.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const HOME = "broker/vocabulary.ts"; // the single allowed definition site

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

// Each rule: a pattern that may ONLY appear in broker/vocabulary.ts (sample DATA
// values like `ragStatus: "AMBER"` are single literals and don't match these).
const RULES: Array<{ label: string; re: RegExp }> = [
  { label: 'the RAG union/triple literal', re: /"GREEN"\s*\|\s*"AMBER"\s*\|\s*"RED"|\{\s*GREEN:\s*0,\s*AMBER:\s*0,\s*RED:\s*0\s*\}/ },
  { label: 'a re-derived `ragFor` policy', re: /\bfunction ragFor\b|\bragFor\s*=/ },
  { label: 'an inline `=== "done"` completion test', re: /[=!]==\s*"done"/ },
];

test("vocabulary: canonical status/RAG meanings live only in broker/vocabulary.ts", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    if (rel === HOME) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const rule of RULES) {
      if (rule.re.test(text)) offenders.push(`${rel} — ${rule.label}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Import the canonical vocabulary from broker/vocabulary instead of re-deriving it:\n  ${offenders.join("\n  ")}`,
  );
});
