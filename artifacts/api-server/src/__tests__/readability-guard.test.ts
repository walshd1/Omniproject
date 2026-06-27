import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Readability guard — encodes the house rules as a test so they stay true, the
 * same way broker-guard / deploy-guard / plane-verifier protect their invariants:
 *
 *   1. Every source file opens with a TITLE — a block comment describing what the
 *      file does (it does that one thing). Allowed to sit just under the imports.
 *   2. Every EXPORTED FUNCTION carries a comment explaining what it does (a JSDoc
 *      directly above, or a section/`//` comment within the few lines above — so a
 *      group documented by one header counts).
 *
 * One generic checker, pointed at several package roots (api-server, the backend
 * catalogue, the scripts package) — the same generic-with-options pattern the
 * backends and brokers use, rather than a copy of this test per package.
 *
 * Generated files and trivial entrypoints are exempt per-root. The guard is
 * deliberately lenient about WHERE the comment is, strict about it EXISTING.
 */

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, "../../../.."); // …/__tests__ → src → api-server → artifacts → repo

/** A package source tree to lint, with its own exemptions (generated/trivial). */
interface GuardRoot {
  /** Repo-relative source directory to walk. */
  dir: string;
  /** Repo-relative files within `dir` that are generated or trivial and exempt. */
  exempt: string[];
}

const ROOTS: GuardRoot[] = [
  {
    dir: "artifacts/api-server/src",
    exempt: [
      "artifacts/api-server/src/broker/contract.schema.generated.ts",
      "artifacts/api-server/src/lib/openapi.generated.ts",
    ],
  },
  {
    dir: "lib/backend-catalogue/src",
    exempt: [
      "lib/backend-catalogue/src/vendors.generated.ts",
      "lib/backend-catalogue/src/vendor-schemas.generated.ts",
    ],
  },
  { dir: "scripts/src", exempt: [] },
];

/** All non-test .ts files under a directory, depth-first. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every file the guard must check, repo-relative, across all roots minus exemptions. */
function filesToCheck(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) {
    const abs = path.join(REPO_ROOT, root.dir);
    const exempt = new Set(root.exempt);
    for (const f of walk(abs)) {
      const rel = path.relative(REPO_ROOT, f);
      if (!exempt.has(rel)) out.push(rel);
    }
  }
  return out;
}

const FILES = filesToCheck();

/** A line that is part of a comment (JSDoc close, block/line body, or `//`). */
const isCommentLine = (l: string): boolean => {
  const t = l.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.endsWith("*/");
};

/** True when the file opens with a comment (allowing leading import statements). */
function hasTitle(lines: string[]): boolean {
  let inImport = false; // skip whole (possibly multi-line) import statements
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (inImport) { if (/ from |["'];?$|;$/.test(l)) inImport = false; continue; }
    if (l.startsWith("import")) { if (!(/ from |;$/.test(l))) inImport = true; continue; }
    if (isCommentLine(l)) return true; // a comment before any real code = title
    return false; // real declaration before any comment → no title
  }
  return false;
}

test("readability: every source file opens with a title comment", () => {
  const offenders = FILES.filter((rel) => !hasTitle(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n")));
  assert.deepEqual(offenders, [], `These files need an opening title comment (what the file does):\n  ${offenders.join("\n  ")}`);
});

test("readability: every exported function has a comment explaining it", () => {
  const offenders: string[] = [];
  for (const rel of FILES) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = /^export (async )?function (\w+)/.exec(line);
      if (!m) return;
      // Documented if any of the few lines above carries a comment — lenient about
      // an intervening declaration (a `const` between the JSDoc and the function)
      // or a `*/` close, strict about a comment EXISTING near it.
      const documented = lines.slice(Math.max(0, i - 5), i).some((l) => isCommentLine(l));
      if (!documented) offenders.push(`${rel}:${i + 1} ${m[2]}`);
    });
  }
  assert.deepEqual(offenders, [], `These exported functions need a comment:\n  ${offenders.join("\n  ")}`);
});
