import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Egress-guard gate — this repo has no ESLint, so the "every outbound HTTP call goes through
 * lib/egress `safeFetch`" rule is enforced here as a test (same idiom as no-unsafe-json-parse).
 *
 * WHY: a bare global `fetch(` re-resolves DNS at connect time (rebinding TOCTOU) and auto-follows up
 * to 20 redirects to an UNVALIDATED `Location` — the exact primitive that lets a benign configured
 * host 302 the gateway into `http://169.254.169.254/…` (cloud metadata → IAM creds). `safeFetch`
 * applies the SSRF/residency guard, PINS the vetted IPs, and re-validates every redirect hop, so all
 * outbound must use it. `safeFetch`/`undiciFetch` are capital-F identifiers, so a lowercase `fetch(`
 * uniquely marks a bare global call.
 *
 * ALLOWLIST records every remaining lowercase `fetch(` that is NOT a global outbound HTTP call (so
 * must not be forced through safeFetch), with its expected occurrence COUNT. A NEW bare fetch fails
 * until classified; changing a listed file's count fails until re-justified — so an unguarded outbound
 * call can't slip in unreviewed.
 */

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

/** file (relative to src/) → { count, reason } for every lowercase `fetch(` that is NOT global HTTP. */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "lib/rate-card-source.ts": {
    count: 3,
    reason: "`fetch` is an injected SourceFetcher param (a broker call returning rows), not global HTTP fetch",
  },
};

/** Strip block + line comments so a `fetch(` mention in prose isn't counted as a call. The `[^:]`
 *  guard before `//` avoids eating the `//` in a `https://` URL literal. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Count bare lowercase `fetch(` calls (not `safeFetch(`/`undiciFetch(`/`.fetch(`) in real code. */
function countBareFetch(file: string): number {
  const code = stripComments(fs.readFileSync(file, "utf8"));
  return (code.match(/(?<![.\w])fetch\s*\(/g) ?? []).length;
}

/** Recursively list every production .ts under src/, excluding lib/egress.ts (the guarded transport
 *  itself) and the __tests__/ directory (test harnesses drive the in-process app, not real egress). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue; // test harnesses, not production egress
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    if (full === path.join(SRC, "lib", "egress.ts")) continue;
    out.push(full);
  }
  return out;
}

test("no unguarded outbound fetch: every server-side HTTP call must go through safeFetch", () => {
  const offenders: string[] = [];
  const seen = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const n = countBareFetch(file);
    if (n === 0) continue;
    seen.add(rel);
    const allow = ALLOWLIST[rel];
    if (!allow) {
      offenders.push(`${rel}: ${n} bare fetch( — route it through lib/egress safeFetch, or classify in ALLOWLIST if it isn't a global HTTP call`);
    } else if (n !== allow.count) {
      offenders.push(`${rel}: bare fetch( count changed ${allow.count} → ${n} — re-verify each is not a global outbound call, then update the count`);
    }
  }
  assert.deepEqual(offenders, [], `Egress-guard gate failed:\n${offenders.join("\n")}`);

  const stale = Object.keys(ALLOWLIST).filter((rel) => !seen.has(rel)).sort();
  assert.deepEqual(stale, [], `Stale ALLOWLIST entries (no bare fetch anymore — remove):\n${stale.join("\n")}`);
});
