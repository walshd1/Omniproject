import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./walk-files";
import { stripComments } from "./ts-source";

/**
 * "Every declared item is built" — the pure core of the coverage guard.
 *
 * Several planes are catalogues of declared items (reports, screens, …) that must each have a real
 * implementation + a test. Most planes are data-driven through a generic renderer, so declared == built
 * by construction; the exception is any plane whose items are **hand-wired** (the report page renders a
 * bespoke component per report id). That's where a catalogue entry can silently drift away from its
 * implementation — exactly what this guard prevents, the same way `guard-e2e-routes` binds App.tsx
 * routes to the e2e manifest.
 *
 * This module is pure (all fs access is injected) so the rules are unit-testable.
 */

/** How a declared id is satisfied: by a named component, or surfaced via another plane (documented). */
export type Impl = string | { surfacedVia: string; reason: string };

export interface CoverageProbes {
  /** Does a component of this name exist in the plane's implementation dir? */
  componentExists(component: string): boolean;
  /** Is the component imported/used in the page/registry that wires the plane? */
  wiredInPage(component: string): boolean;
  /** Is the component referenced by at least one test? */
  hasTest(component: string): boolean;
}

export interface CoverageResult {
  ok: boolean;
  errors: string[];
}

/**
 * Check one plane: every declared id must map to an implementation that exists, is wired into the page,
 * and is tested — and the map must not carry stale entries for ids the catalogue no longer declares.
 */
export function checkCoverage(plane: string, declaredIds: readonly string[], implMap: Record<string, Impl>, probes: CoverageProbes): CoverageResult {
  const errors: string[] = [];
  const declared = new Set(declaredIds);

  for (const id of declaredIds) {
    const impl = implMap[id];
    if (impl === undefined) {
      errors.push(`${plane}: "${id}" is declared in the catalogue but has no implementation mapping — build it and add it to the coverage map (or classify it as surfaced elsewhere).`);
      continue;
    }
    if (typeof impl !== "string") continue; // surfaced via another plane — a documented exception.
    if (!probes.componentExists(impl)) errors.push(`${plane}: "${id}" maps to component "${impl}" which doesn't exist.`);
    else {
      if (!probes.wiredInPage(impl)) errors.push(`${plane}: "${id}" component "${impl}" exists but isn't wired into the page — a user can't reach it.`);
      if (!probes.hasTest(impl)) errors.push(`${plane}: "${id}" component "${impl}" has no test referencing it.`);
    }
  }

  for (const id of Object.keys(implMap)) {
    if (!declared.has(id)) errors.push(`${plane}: coverage map has a stale entry for "${id}" — no such item in the catalogue.`);
  }

  return { ok: errors.length === 0, errors };
}

// ── fs-backed probe factory (used by the real guard; tests inject their own) ─────

/** Escape a component name for embedding in a RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Source with comments removed (quote-aware) and whole-line `import` statements dropped — so a name
 *  that appears ONLY in an import or a comment is NOT counted as a real reference. This is the
 *  difference between "the file mentions the name" and "the file actually uses it". */
function referenceBody(src: string): string {
  return stripComments(src)
    .split("\n")
    .filter((l) => !/^\s*import\b/.test(l))
    .join("\n");
}

/** The SPA `src` root that a page file lives under (the last `src` path segment), or null — used to
 *  broaden the test search beyond the component's own directory. */
function srcRootOf(pageFile: string): string | null {
  const parts = pageFile.split(path.sep);
  const idx = parts.lastIndexOf("src");
  return idx < 0 ? null : parts.slice(0, idx + 1).join(path.sep);
}

/** Collect the contents of every `*.test.tsx` / `*.test.ts` under any of `dirs` (deduped by path). */
function testSourcesUnder(dirs: string[]): string[] {
  const files = new Set<string>();
  for (const d of dirs) for (const f of walkFiles(d, { extensions: [".test.tsx", ".test.ts"] })) files.add(f);
  return [...files].map((f) => fs.readFileSync(f, "utf8"));
}

/**
 * Build probes that read the real tree. A component counts as:
 *  - `wiredInPage` — only if the page actually RENDERS it (`<Name …`) or REGISTERS it (as a record
 *    value / array element), not merely imports or comments it (a bare `\bName\b` used to pass on an
 *    unused import).
 *  - `hasTest` — only if some test RENDERS it (`<Name …`) or names it inside a `render*(` / `expect(`
 *    call, not merely imports it. Tests are searched in `dir` AND across the whole SPA `src` tree, so
 *    a test that lives next to a shared harness (not beside the component) still counts.
 */
export function fsProbes(dir: string, pageFile: string): CoverageProbes {
  const pageBody = referenceBody(fs.existsSync(pageFile) ? fs.readFileSync(pageFile, "utf8") : "");
  const root = srcRootOf(pageFile);
  const testBodies = testSourcesUnder([dir, ...(root ? [root] : [])]).map(referenceBody);
  return {
    componentExists: (c) => fs.existsSync(path.join(dir, `${c}.tsx`)),
    // Rendered as JSX, or registered as a record value / array element.
    wiredInPage: (c) => new RegExp(`<${esc(c)}[\\s/>]`).test(pageBody) || new RegExp(`[:[]\\s*${esc(c)}\\b`).test(pageBody),
    // Rendered in a test, or referenced inside a render*/expect call.
    hasTest: (c) =>
      testBodies.some(
        (b) => new RegExp(`<${esc(c)}[\\s/>]`).test(b) || new RegExp(`\\b(render\\w*|expect)\\s*\\([^)]*\\b${esc(c)}\\b`).test(b),
      ),
  };
}

/** List declared ids from a catalogue assets dir (one `<id>.json` per item). */
export function idsFromAssets(assetsDir: string): string[] {
  return fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
}
