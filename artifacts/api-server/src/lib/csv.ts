/** Minimal, dependency-free CSV serializer (RFC 4180). */

export type CsvValue = string | number | boolean | null | undefined;

function escapeCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  // Arrays/objects that slip through become JSON.
  if (typeof value === "object") s = JSON.stringify(value);
  // CSV-injection guard: a cell beginning with a formula trigger (= + - @ or a
  // leading tab/CR) executes when the file is opened in Excel/Sheets. Backend
  // field values are attacker-influenceable, so neutralise them with a leading
  // apostrophe before the RFC-4180 quoting.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Build a CSV string from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  // Prepend a UTF-8 BOM so Excel opens non-ASCII content correctly.
  return "﻿" + lines.join("\r\n");
}
