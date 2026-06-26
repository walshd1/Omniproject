/**
 * Data-lineage helpers — pure, so completeness/provenance maths and the
 * in-context export are unit-tested and shared. These power the "where did this
 * data come from, and how complete is it" widget on each data screen.
 *
 * The honesty problem they solve: a capability-gated overlay can render a
 * confident-looking table built on partial backend data. These functions make
 * the gaps and the sources explicit, so a number is never mistaken for complete.
 */

export interface FieldSpec {
  key: string;
  label: string;
}

/** A value counts as "present" if it carries real information. 0 and false DO
 *  count (a £0 budget / blocked=false are real values); null/""/[] do not. */
export function isPresent(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export interface FieldCompleteness extends FieldSpec {
  present: number;
  total: number;
  pct: number; // 0–100, rounded
}

function pct(present: number, total: number): number {
  return total > 0 ? Math.round((present / total) * 100) : 0;
}

/** Per-field fill rate across the rows currently on screen. */
export function fieldCompleteness(rows: ReadonlyArray<Record<string, unknown>>, fields: ReadonlyArray<FieldSpec>): FieldCompleteness[] {
  return fields.map((f) => {
    const present = rows.reduce((n, r) => n + (isPresent(r[f.key]) ? 1 : 0), 0);
    return { ...f, present, total: rows.length, pct: pct(present, rows.length) };
  });
}

export interface OverallCompleteness {
  present: number; // populated cells
  total: number; // rows × fields
  pct: number;
  rows: number;
  fields: number;
}

/** Overall fill rate: populated cells ÷ (rows × specced fields). */
export function overallCompleteness(rows: ReadonlyArray<Record<string, unknown>>, fields: ReadonlyArray<FieldSpec>): OverallCompleteness {
  const total = rows.length * fields.length;
  const present = fields.reduce((n, f) => n + rows.reduce((m, r) => m + (isPresent(r[f.key]) ? 1 : 0), 0), 0);
  return { present, total, pct: pct(present, total), rows: rows.length, fields: fields.length };
}

export interface SourceCount {
  source: string;
  count: number;
}

/**
 * Group rows by their origin so the lineage is visible — which backend(s) the
 * on-screen data came from, biggest first. Defaults to the `source` field;
 * pass an accessor for provenance or any other dimension.
 */
export function sourceBreakdown(
  rows: ReadonlyArray<Record<string, unknown>>,
  accessor: (r: Record<string, unknown>) => unknown = (r) => r["source"],
): SourceCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = accessor(r);
    const key = isPresent(raw) ? String(raw) : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** One CSV cell, escaped per RFC 4180; arrays/objects flattened readably. */
function cell(v: unknown): string {
  let s: string;
  if (v == null) s = "";
  else if (Array.isArray(v)) s = v.join("; ");
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialise rows to CSV for the given columns (label header, key lookup). */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns: ReadonlyArray<FieldSpec>): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(","));
  return [header, ...body].join("\n");
}

/** The lineage columns appended to every export so a row can be traced back to
 *  its origin system and last writer. */
export const LINEAGE_COLUMNS: FieldSpec[] = [
  { key: "id", label: "id" },
  { key: "source", label: "source" },
  { key: "provenance", label: "provenance" },
  { key: "lastUpdatedBy", label: "lastUpdatedBy" },
];

/** Trigger a client-side file download (no server round-trip) — exports exactly
 *  the rows on screen. Uses a data URL so it works without Blob/object-URL. */
export function downloadText(filename: string, mime: string, text: string): void {
  const a = document.createElement("a");
  a.href = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
