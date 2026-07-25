import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Vocabulary guard (SPA) — enforces the data/code split for the STATUS completion vocabulary, the sibling of
 * the api-server guard. A canonical status meaning like the `=== "done"` / `=== "cancelled"` completion test
 * is load-bearing DATA; if it's re-derived inline anywhere but the vocabulary home a backend (or a scope) with
 * a different/relabelled vocabulary silently mis-classifies. Everything must go through lib/status-vocab
 * (isDone / isCancelled / isTerminal / classifyStage) instead.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Files allowed to name the literal "done"/"cancelled" — the vocabulary HOME plus places where the string is
// NOT a work-item status: the status-vocab module itself; a comment reference; a search KEYWORD the user types
// (is:done); a flow-state BUCKET name (already classified); a setup-wizard step named "done".
const ALLOWLIST = new Set([
  "lib/status-vocab.ts",
  "lib/methodology.ts",                       // comment referencing the old comparison
  "lib/task-search.ts",                        // matches the `is:done` search keyword, not a status field
  "components/reports/ValueStreamFlow.tsx",    // compares a flowState() bucket, not raw status
  "components/setup/ProfileStep.tsx",          // wizard step id "done", not a work-item status
]);

// May ONLY appear (as a status comparison) in the allowlisted files.
const RULES: Array<{ label: string; re: RegExp }> = [
  { label: 'an inline `=== "done"` completion test', re: /[=!]==\s*"done"/ },
  { label: 'an inline `=== "cancelled"` terminal test', re: /[=!]==\s*"cancelled"/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(full, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

describe("vocabulary guard (SPA)", () => {
  it("canonical status completion meanings go through lib/status-vocab, not inline literals", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      if (ALLOWLIST.has(rel)) continue;
      const text = fs.readFileSync(file, "utf8");
      for (const rule of RULES) if (rule.re.test(text)) offenders.push(`${rel} — ${rule.label}`);
    }
    expect(offenders, `Use lib/status-vocab (isDone/isCancelled/isTerminal) instead of an inline literal:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
