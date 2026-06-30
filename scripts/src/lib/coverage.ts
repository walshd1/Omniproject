import fs from "node:fs";
import path from "node:path";

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

/** Build probes that read the real tree: components in `dir`, wired in `pageFile`, tested by any
 *  `*.test.tsx` under `dir`. */
export function fsProbes(dir: string, pageFile: string): CoverageProbes {
  const pageSrc = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, "utf8") : "";
  const testSrc = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".test.tsx") || f.endsWith(".test.ts")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n")
    : "";
  return {
    componentExists: (c) => fs.existsSync(path.join(dir, `${c}.tsx`)),
    wiredInPage: (c) => new RegExp(`\\b${c}\\b`).test(pageSrc),
    hasTest: (c) => new RegExp(`\\b${c}\\b`).test(testSrc),
  };
}

/** List declared ids from a catalogue assets dir (one `<id>.json` per item). */
export function idsFromAssets(assetsDir: string): string[] {
  return fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort() : [];
}
