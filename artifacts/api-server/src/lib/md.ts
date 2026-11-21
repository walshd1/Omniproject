/**
 * Dependency-free Markdown table writer (GitHub-flavoured), matching the
 * conservative no-dependency approach of the CSV/XLSX writers.
 */

export type MdValue = string | number | boolean | null | undefined;

function cell(v: MdValue): string {
  if (v === null || v === undefined) return "";
  // Escape backslashes FIRST, then pipes, then collapse newlines — so the table stays one row per
  // record. Order matters: escaping `|`→`\|` without first escaping a literal `\` leaves an input like
  // `a\|b` as `a\\|b`, whose trailing `|` is an unescaped column separator (incomplete escaping, CWE-116).
  return String(v).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Render a titled GitHub-flavoured Markdown table from headers + rows. */
export function toMarkdown(title: string, headers: string[], rows: MdValue[][]): string {
  const head = `| ${headers.map(cell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${headers.map((_h, i) => cell(r[i])).join(" | ")} |`).join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return `# ${title}\n\n_Exported ${stamp} · ${rows.length} rows_\n\n${head}\n${sep}\n${body}\n`;
}
