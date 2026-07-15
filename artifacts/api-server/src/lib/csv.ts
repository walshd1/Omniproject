/** Minimal, dependency-free CSV serializer (RFC 4180). */

export type CsvValue = string | number | boolean | null | undefined;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  // Only string-derived cells can carry a formula-injection payload. A numeric/boolean cell (e.g.
  // -42 or true) must NOT get the guard prefix — that would turn a real number into a text literal.
  const stringLike = typeof value === "string" || typeof value === "object";
  let s = typeof value === "string" ? value : String(value);
  // Arrays/objects that slip through become JSON.
  if (typeof value === "object") s = JSON.stringify(value);
  // CSV-injection guard: a cell beginning with a formula trigger (= + - @ or a
  // leading tab/CR) executes when the file is opened in Excel/Sheets. Backend
  // field values are attacker-influenceable, so neutralise them with a leading
  // apostrophe before the RFC-4180 quoting.
  if (stringLike && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** UTF-8 BOM prefix so Excel opens non-ASCII content correctly. */
export const CSV_BOM = "﻿";

/** Encode ONE CSV record (header or data row) — the per-row kernel, exposed so a large export can be
 *  streamed line-by-line to the socket instead of building the whole string in memory first. */
export function csvLine(cells: CsvValue[]): string {
  return cells.map(escapeCell).join(",");
}

/** Build a CSV string from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [csvLine(headers)];
  for (const row of rows) {
    lines.push(csvLine(row));
  }
  return CSV_BOM + lines.join("\r\n");
}
