/**
 * Shared TypeScript-AST access for the guard/generator scripts.
 *
 * TypeScript 7 (the native port) no longer ships an in-process, synchronous
 * `ts.createSourceFile(fileName, text, …)` text parser: the classic compiler API
 * moved off the bare `"typescript"` entry point, and the parser now lives inside
 * the native server. The syntactic node vocabulary — `SyntaxKind`, every `isX`
 * type-guard, `getLeadingCommentRanges`, the JSDoc helpers, and all node types —
 * is re-exported here from `typescript/unstable/ast`, and this module owns the one
 * remaining moving part: turning a file on disk into a walkable `SourceFile`.
 *
 * `parseSourceFile()` drives the `typescript/unstable/sync` API (a single, lazily
 * spawned native server, closed on process exit) to load each file's project and
 * hand back a fully-materialised AST — real local nodes with `.statements`,
 * `.forEachChild()`, `.getText()`, `.getFullStart()`, etc. Every generator/guard
 * that used to call `ts.createSourceFile` now calls `parseSourceFile` instead and
 * keeps walking the tree exactly as before.
 */
import { API } from "typescript/unstable/sync";
import type { ModifierLike, Node, NodeArray, SourceFile } from "typescript/unstable/ast";

// Re-export the whole syntactic AST surface so callers keep a single `ts` namespace:
// `import * as ts from "./lib/ts-ast"` then `ts.SyntaxKind`, `ts.isInterfaceDeclaration`,
// `ts.getLeadingCommentRanges`, `ts.SourceFile`, … all resolve here.
export * from "typescript/unstable/ast";

/** Lazily-spawned native server + the latest snapshot; one per script process. */
let api: API | undefined;
let snapshot: ReturnType<API["updateSnapshot"]> | undefined;
const opened = new Set<string>();

/** Ensure the native server is running and `abs` is loaded, returning the latest snapshot. */
function ensureOpen(abs: string): NonNullable<typeof snapshot> {
  if (!api) {
    api = new API({ cwd: process.cwd() });
    // A one-shot script exits when done; make sure the server process goes with it.
    process.once("exit", () => {
      try {
        api?.close();
      } catch {
        /* best-effort shutdown */
      }
    });
  }
  // Opens persist across snapshots, so the newest snapshot always includes every
  // file opened so far — open each path once, then always query the latest snapshot.
  if (!opened.has(abs) || !snapshot) {
    snapshot = api.updateSnapshot({ openFiles: [abs] });
    opened.add(abs);
  }
  return snapshot;
}

/**
 * Parse a source file on disk into a syntactic `SourceFile` AST via the TS7 native API.
 *
 * Replaces the removed `ts.createSourceFile(abs, fs.readFileSync(abs), …)`: the server
 * reads the file, resolves the tsconfig project that owns it, and returns a walkable AST.
 * Use `sourceFile.text` where the old code needed the raw file text for comment ranges.
 */
export function parseSourceFile(abs: string): SourceFile {
  const snap = ensureOpen(abs);
  const project = snap.getDefaultProjectForFile(abs);
  if (!project) throw new Error(`ts-ast: no TypeScript project resolved for ${abs}`);
  const sf = project.program.getSourceFile(abs);
  if (!sf) throw new Error(`ts-ast: failed to parse ${abs}`);
  return sf;
}

/**
 * The modifiers on any node, or an empty array — replaces TS7-removed
 * `ts.canHaveModifiers` / `ts.getModifiers`. Modifiers are now a plain optional
 * `modifiers` property on the declaration nodes that can carry them.
 */
export function getModifiers(node: Node): readonly ModifierLike[] {
  return (node as { modifiers?: NodeArray<ModifierLike> }).modifiers ?? [];
}
