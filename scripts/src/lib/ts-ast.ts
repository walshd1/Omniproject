/**
 * Compiler-API helper shared by the AST-driven generators (gen-contract, gen-api-reference,
 * gen-function-map): the single place that opens a source file into a `ts.SourceFile`, so all three
 * parse with the same options (`ScriptTarget.Latest`, parent pointers set) rather than re-typing the
 * `ts.createSourceFile(...)` boilerplate. Distinct from `ts-source.ts`, which does string-level
 * comment/import scanning for the guards and deliberately pulls in NO `typescript` dependency.
 */
import fs from "node:fs";
import ts from "typescript";

/**
 * Parse a TS/JS file into a `ts.SourceFile` with parent pointers set (`setParentNodes: true`), reading
 * from disk unless `text` is supplied (callers that already have the file contents pass them to avoid a
 * second read). One definition so every generator opens source identically.
 */
export function parseSourceFile(absPath: string, text?: string): ts.SourceFile {
  return ts.createSourceFile(absPath, text ?? fs.readFileSync(absPath, "utf8"), ts.ScriptTarget.Latest, true);
}
