/**
 * Small, dependency-free helpers for scanning TypeScript/JavaScript source in the guard scripts.
 *
 * The seam guards (`guard-broker-isolation`, `guard-zero-at-rest-above-seam`) both need to reason
 * about *code* while ignoring comments — and to do it identically, so one guard can't be quietly
 * weaker than the other. These two helpers are that single shared source of truth.
 */

/**
 * Extract the imported module specifier from a single line, covering the static forms
 * (`import … from "x"`, bare `import "x"`) AND the dynamic/CommonJS forms (`import("x")`,
 * `require("x")`). Returns the specifier string, or `null` if the line has no import.
 *
 * Both seam guards use this so neither can miss a form the other catches — a dynamic
 * `await import("./broker/reference-broker")` must be as visible as a static import.
 */
export function importSpecifier(line: string): string | null {
  const m = line.match(/(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*["']([^"']+)["']/);
  return m ? m[1]! : null;
}

/**
 * Return `src` with every line and block comment removed, but with string / template-literal
 * contents and — crucially — every newline preserved, so line numbers are unchanged.
 *
 * Unlike a naive `indexOf("//")`, this is quote-aware: a `//` or `/*` that appears *inside* a
 * string literal (e.g. the `//` in `"https://n8n.cloud"`) is NOT treated as a comment, so real
 * in-code tokens survive the strip and remain visible to a naming scan. Comments are the only
 * thing removed; string bodies are kept verbatim (over-inclusive for a guard is safe — it can
 * only ever flag more code, never hide a leak).
 *
 * Template-expression interiors (`${…}`) are treated as literal template text rather than being
 * re-parsed as code; that is deliberately conservative (it can only retain more tokens, never
 * strip a real one) and avoids the complexity of nested-template parsing.
 */
export function stripComments(src: string): string {
  const n = src.length;
  let out = "";
  let state: "code" | "sq" | "dq" | "tpl" | "line" | "block" = "code";
  let i = 0;
  while (i < n) {
    const c = src[i]!;
    const c2 = src[i + 1];
    switch (state) {
      case "code":
        if (c === "/" && c2 === "/") { state = "line"; i += 2; continue; }
        if (c === "/" && c2 === "*") { state = "block"; i += 2; continue; }
        if (c === "'") state = "sq";
        else if (c === '"') state = "dq";
        else if (c === "`") state = "tpl";
        out += c; i++; continue;
      case "sq":
      case "dq":
      case "tpl": {
        if (c === "\\") { out += c; if (i + 1 < n) out += src[i + 1]; i += 2; continue; }
        out += c;
        const closer = state === "sq" ? "'" : state === "dq" ? '"' : "`";
        if (c === closer) state = "code";
        i++; continue;
      }
      case "line":
        if (c === "\n") { out += c; state = "code"; }
        i++; continue;
      case "block":
        if (c === "*" && c2 === "/") { state = "code"; i += 2; continue; }
        if (c === "\n") out += c; // keep line count aligned
        i++; continue;
    }
  }
  return out;
}

/** Per-line CODE (comments removed, line numbers preserved) for a source string. */
export function codeLines(src: string): { line: number; text: string }[] {
  return stripComments(src).split("\n").map((text, i) => ({ line: i + 1, text }));
}
