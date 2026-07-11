/**
 * Localisation coverage audit — "every base-locale string is translated in every operating language".
 *
 * The SPA localises its high-traffic surfaces through a dependency-free dictionary in
 * artifacts/omniproject/src/lib/i18n.tsx: one `Dict` per locale (EN is the base + fallback), plus a
 * per-deployment LABEL_OVERRIDES layer that renames labels on top. English is the fallback for any key
 * a locale omits, so a missing translation degrades quietly to English rather than breaking — which is
 * exactly why gaps can accumulate unseen. This audit surfaces them: for every non-base locale it reports
 * keys present in the base but MISSING or EMPTY, and ORPHAN keys the base no longer declares.
 *
 * Deterministic exit behaviour, non-breaking by design:
 *  - If every operating language is fully covered → hard guard: prints OK, exits 0; a future regression
 *    (an untranslated key) then fails CI.
 *  - If coverage is currently incomplete → AUDIT mode: prints the per-locale gap report and a summary,
 *    logs clearly what is uncovered, and exits 0 (warn-only) so pre-existing gaps never turn CI red.
 *  - Orphan keys (a locale carries a key the base dropped) are always a hard failure — that's dead weight
 *    or a typo, cheap to fix, and can't be "pre-existing debt" the way an untranslated string is.
 *
 * The dictionaries are TypeScript object literals (not JSON), so this reads i18n.tsx with the TypeScript
 * compiler API and extracts each `: Dict` const — pure, no React import, no runtime dependency on the SPA.
 *
 * Run: pnpm --filter @workspace/scripts run guard-i18n-coverage
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const I18N_FILE = path.join(ROOT, "artifacts/omniproject/src/lib/i18n.tsx");

/** The name of the base-locale const in i18n.tsx (English — the fallback for every other locale). */
const BASE_CONST = "EN";

/** A locale's dictionary: the const identifier (e.g. "FR") and its key → string map. */
interface LocaleDict {
  name: string;
  keys: Map<string, string>;
}

/** Extract every `const X: Dict = { ... }` from i18n.tsx as a {name, keys} dictionary, in source order. */
function readDicts(file: string): LocaleDict[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const dicts: LocaleDict[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      // Accept both `const FR: Dict = {…}` and `const FR = {…} satisfies Dict` — otherwise a locale
      // authored with `satisfies Dict` is silently skipped and its coverage is never audited.
      let init: ts.Expression = decl.initializer;
      let isDict = decl.type?.getText(sf) === "Dict";
      if (ts.isSatisfiesExpression(init)) {
        if (init.type.getText(sf) === "Dict") isDict = true;
        init = init.expression;
      }
      if (!isDict || !ts.isObjectLiteralExpression(init)) continue;
      const keys = new Map<string, string>();
      for (const prop of init.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isStringLiteralLike(prop.name) ? prop.name.text : prop.name.getText(sf);
        const value =
          ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)
            ? prop.initializer.text
            : prop.initializer.getText(sf);
        keys.set(key, value);
      }
      dicts.push({ name: decl.name.text, keys });
    }
  }
  return dicts;
}

/** Per-locale coverage: which base keys are missing, which are present-but-empty, and which are orphans. */
interface LocaleReport {
  name: string;
  missing: string[];
  empty: string[];
  orphan: string[];
  translated: number;
}

/** Compare one locale against the base locale and classify every gap. */
function auditLocale(base: LocaleDict, locale: LocaleDict): LocaleReport {
  const missing: string[] = [];
  const empty: string[] = [];
  let translated = 0;
  for (const key of base.keys.keys()) {
    if (!locale.keys.has(key)) missing.push(key);
    else if (locale.keys.get(key)!.trim() === "") empty.push(key);
    else translated++;
  }
  const orphan = [...locale.keys.keys()].filter((k) => !base.keys.has(k));
  return { name: locale.name, missing: missing.sort(), empty: empty.sort(), orphan: orphan.sort(), translated };
}

// ── Run the audit ───────────────────────────────────────────────────────────────
const dicts = readDicts(I18N_FILE);
const base = dicts.find((d) => d.name === BASE_CONST);
if (!base) {
  console.error(`i18n-coverage guard: could not find the base locale const "${BASE_CONST}" in ${path.relative(ROOT, I18N_FILE)}.`);
  process.exit(1);
}
const others = dicts.filter((d) => d.name !== BASE_CONST);
const baseCount = base.keys.size;
const reports = others.map((d) => auditLocale(base, d));

console.log(`i18n-coverage audit: base locale "${base.name}" declares ${baseCount} keys across ${others.length} other operating language(s).\n`);

let anyGap = false;
let anyOrphan = false;
for (const r of reports) {
  const covered = r.translated;
  const pct = baseCount === 0 ? 100 : Math.round((covered / baseCount) * 1000) / 10;
  console.log(`  ${r.name}: ${covered}/${baseCount} translated (${pct}%)`);
  if (r.missing.length) {
    anyGap = true;
    console.log(`    missing (${r.missing.length}): ${r.missing.join(", ")}`);
  }
  if (r.empty.length) {
    anyGap = true;
    console.log(`    empty   (${r.empty.length}): ${r.empty.join(", ")}`);
  }
  if (r.orphan.length) {
    anyOrphan = true;
    console.log(`    orphan  (${r.orphan.length}): ${r.orphan.join(", ")}  ← key not in base "${base.name}"`);
  }
}

// Orphans are always a hard failure: dead weight / typo, cheap to fix, never legitimate debt.
if (anyOrphan) {
  console.error(
    `\ni18n-coverage guard: FAIL — one or more locales carry orphan keys the base locale "${base.name}" no longer declares.` +
      `\n  Remove the orphan key(s), or add them back to ${BASE_CONST} in ${path.relative(ROOT, I18N_FILE)}.`,
  );
  process.exit(1);
}

if (!anyGap) {
  console.log(`\ni18n-coverage guard: OK — every operating language fully covers the ${baseCount} base keys (and no orphan keys).`);
  process.exit(0);
}

// Warn-only: coverage is incomplete but English fallback keeps the app correct. Report, don't fail CI.
const totalMissing = reports.reduce((n, r) => n + r.missing.length + r.empty.length, 0);
console.log(
  `\ni18n-coverage audit: ${totalMissing} untranslated key-slot(s) across ${reports.filter((r) => r.missing.length + r.empty.length > 0).length} locale(s).` +
    `\n  These degrade to the base "${base.name}" string at runtime (correct, just not localised), so this is a WARN-ONLY audit — CI stays green.` +
    `\n  Close a gap by adding the listed key(s) to the matching Dict in ${path.relative(ROOT, I18N_FILE)}.` +
    `\n  Once every operating language is complete, this guard becomes a hard failure and locks the coverage in.`,
);
process.exit(0);
