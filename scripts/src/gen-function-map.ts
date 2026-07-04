/**
 * Function-map generator.
 *
 * Emits docs/FUNCTION-MAP.md: a one-screen-per-package index of every source
 * file's TITLE (what the file does) and every exported function with its
 * one-line comment. The goal is that a good developer can audit how the codebase
 * is put together by skimming this map — without reading the long tech docs.
 *
 * It reads the same truth the readability guard enforces (each file has a title,
 * each exported function has a comment), so this document is just those comments
 * collated and linked. Output is deterministic (sorted, no timestamps) and
 * checked into the repo; a CI drift guard fails the build if it is stale, exactly
 * like the broker-contract generator — so the map can never lie about the code.
 *
 * Run: pnpm --filter @workspace/scripts run gen-function-map
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./lib/walk-files";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT_MD = path.join(ROOT, "docs/FUNCTION-MAP.md");

/** A package source tree to map, with the files that are generated/trivial. */
interface MapRoot {
  /** Human label for the section heading. */
  label: string;
  /** Repo-relative source directory to walk. */
  dir: string;
  /** One-line description of the package's job. */
  blurb: string;
  /** Repo-relative files to skip (generated banners, no hand-written prose). */
  exempt: string[];
}

const ROOTS: MapRoot[] = [
  {
    label: "Gateway (`artifacts/api-server`)",
    dir: "artifacts/api-server/src",
    blurb: "The stateless Express gateway: routes above the broker seam, the broker adapter below it, and the supporting libraries.",
    exempt: [
      "artifacts/api-server/src/broker/contract.schema.generated.ts",
      "artifacts/api-server/src/lib/openapi.generated.ts",
    ],
  },
  {
    label: "Backend catalogue (`lib/backend-catalogue`)",
    dir: "lib/backend-catalogue/src",
    blurb: "The seven vendor-neutral integration-plane registries (backends, brokers, outputs, notifications, methodologies, reports, screens) shared across the workspace.",
    exempt: [],
  },
  {
    label: "Scripts (`scripts`)",
    dir: "scripts/src",
    blurb: "Developer + operator tooling: generators, the setup wizard, verifiers, and load/smoke harnesses.",
    exempt: [],
  },
];

/** One exported function and the first line of its explaining comment. */
interface FnEntry {
  name: string;
  doc: string;
}

/** One source file: its title and its exported functions. */
interface FileEntry {
  rel: string;
  title: string;
  fns: FnEntry[];
}

/** Collapse a raw comment block to its first complete sentence (the summary). */
function firstLine(comment: string): string {
  // Strip the comment delimiters, join the body into flowing prose, and stop at
  // the first paragraph break so a multi-paragraph block reduces to its lead.
  const lines = comment
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*[/*]+/, "").trim());
  const lead: string[] = [];
  for (const l of lines) {
    if (!l) { if (lead.length) break; else continue; } // blank line ends the lead paragraph
    lead.push(l);
  }
  const text = lead.join(" ").replace(/\s+/g, " ").trim();
  // First sentence only, so the map stays one line per item — but don't break on
  // an abbreviation's dot (e.g. / i.e. / etc.) or a single-letter initial.
  const m = /(?<!\b(?:e\.g|i\.e|etc|vs|cf|no|[A-Z]))\. /.exec(text);
  return m ? text.slice(0, m.index + 1) : text;
}

/** A comment range plus the source so we can slice its text. */
type Range = ts.CommentRange;

/** Join a contiguous run of comment ranges (consecutive `//` lines or one block). */
function joinRun(fullText: string, ranges: Range[]): string {
  if (!ranges.length) return "";
  // A run is broken only by non-whitespace between two ranges.
  const start = ranges[0]!;
  let end = start;
  for (let i = 1; i < ranges.length; i++) {
    const between = fullText.slice(end.end, ranges[i]!.pos);
    if (between.trim() !== "") break;
    end = ranges[i]!;
  }
  return firstLine(fullText.slice(start.pos, end.end));
}

/** The nearest comment immediately above a node (JSDoc or contiguous `//` lines). */
function leadingComment(fullText: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? [];
  if (!ranges.length) return "";
  // Take the run that ENDS at the last range (the comment closest to the node).
  const tail: Range[] = [ranges[ranges.length - 1]!];
  for (let i = ranges.length - 2; i >= 0; i--) {
    if (fullText.slice(ranges[i]!.end, tail[0]!.pos).trim() !== "") break;
    tail.unshift(ranges[i]!);
  }
  return joinRun(fullText, tail);
}

/** The file's title: the comment run that opens the file. */
function fileTitle(sf: ts.SourceFile, fullText: string): string {
  for (const stmt of sf.statements) {
    const r = ts.getLeadingCommentRanges(fullText, stmt.getFullStart()) ?? [];
    if (r.length) return joinRun(fullText, r); // the first commented statement carries the title
  }
  return "";
}

/** Extract the title + exported functions from one source file. */
function readFile(abs: string, rel: string): FileEntry {
  const fullText = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, fullText, ts.ScriptTarget.Latest, true);
  const fns: FnEntry[] = [];

  for (const stmt of sf.statements) {
    const exported = ts.canHaveModifiers(stmt) && (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    // `export function foo()`
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      fns.push({ name: stmt.name.text, doc: leadingComment(fullText, stmt) });
    }
    // `export const foo = (...) => ...` (arrow/function expression only)
    else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
          fns.push({ name: decl.name.text, doc: leadingComment(fullText, stmt) });
        }
      }
    }
  }

  return { rel, title: fileTitle(sf, fullText), fns };
}

// ── Build the model ───────────────────────────────────────────────────────────
const sections = ROOTS.map((root) => {
  const exempt = new Set(root.exempt);
  const files = walkFiles(path.join(ROOT, root.dir), { extensions: [".ts"], excludeSuffixes: [".test.ts"] })
    .map((abs) => ({ abs, rel: path.relative(ROOT, abs) }))
    .filter(({ rel }) => !exempt.has(rel))
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map(({ abs, rel }) => readFile(abs, rel));
  return { root, files };
});

// ── Emit Markdown ─────────────────────────────────────────────────────────────
const md: string[] = [];
md.push("<!-- GENERATED by scripts/src/gen-function-map.ts — do not edit. Run `pnpm --filter @workspace/scripts run gen-function-map`. -->");
md.push("# OmniProject function map");
md.push("");
md.push(
  "A developer's-eye index of the codebase: every source file, what it does, and " +
    "the exported functions it offers — each with the one-line comment from the code " +
    "itself. Skim this to learn how OmniProject is put together without reading the " +
    "full technical docs; follow the links into the code or the deeper guides when you " +
    "need detail.",
);
md.push("");
md.push(
  "This file is **generated** from the source comments and kept honest by a CI drift " +
    "guard (and by the readability guard, which requires every file to have a title and " +
    "every exported function a comment). Don't edit it by hand — improve the comments in " +
    "the code and regenerate.",
);
md.push("");

// Table of contents.
md.push("## Packages");
md.push("");
for (const { root } of sections) {
  const anchor = root.label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
  md.push(`- [${root.label}](#${anchor}) — ${root.blurb}`);
}
md.push("");

let totalFiles = 0;
let totalFns = 0;
for (const { root, files } of sections) {
  md.push(`## ${root.label}`);
  md.push("");
  md.push(root.blurb);
  md.push("");
  for (const f of files) {
    totalFiles++;
    totalFns += f.fns.length;
    md.push(`### \`${f.rel}\``);
    md.push("");
    md.push(f.title || "_(no title)_");
    md.push("");
    if (f.fns.length) {
      md.push("| Function | What it does |");
      md.push("| --- | --- |");
      for (const fn of f.fns) md.push(`| \`${fn.name}\` | ${fn.doc || "—"} |`);
      md.push("");
    }
  }
}

fs.writeFileSync(OUT_MD, md.join("\n") + "\n");

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`function map: ${totalFiles} files, ${totalFns} exported functions across ${sections.length} packages`);
console.log(`  → ${path.relative(ROOT, OUT_MD)}`);
