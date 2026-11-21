/**
 * Markdown emit helpers for the codegen scripts (`gen-contract`, `gen-function-map`).
 */

/**
 * Make an arbitrary string safe to drop into a GitHub-flavoured Markdown *table cell*.
 *
 * A raw `|` inside a cell — common in TypeScript types the generators emit verbatim, e.g.
 * `Promise<Issue | null>` or `op: "create" | "update" | "delete"` — is a column separator and
 * splits the row into extra columns. Escaping it to `\|` keeps the type in one cell. Newlines
 * (which would also break the row) collapse to spaces.
 */
export function escapeTableCell(s: string): string {
  // Escape backslashes FIRST, then pipes, then collapse newlines. Order matters: escaping `|`→`\|`
  // without first escaping a literal `\` leaves an input like `a\|b` as `a\\|b`, whose trailing `|`
  // is then an unescaped column separator (incomplete escaping, CWE-116).
  return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
