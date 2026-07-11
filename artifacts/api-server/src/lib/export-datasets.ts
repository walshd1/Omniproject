import type { Row } from "./data";
import { toCsv, type CsvValue } from "./csv";
import { buildXlsx, type Sheet } from "./xlsx";
import { toMarkdown } from "./md";
import { buildPdf } from "./pdf";

/**
 * Pure export rendering — the column order, cell coercion, matrix flattening and format→serialiser
 * registry, shared by the HTTP export route (routes/export.ts) and the scheduled export job
 * (lib/scheduled-export.ts). No `req`, no IO: rows in → a downloadable string/Buffer out.
 */

// Column order for each dataset (also the export header row).
export const PROJECT_COLS = ["id", "identifier", "name", "source", "issueCount", "completedCount", "memberCount", "description", "updatedAt"];
export const ISSUE_COLS = ["id", "projectId", "title", "status", "priority", "assignee", "labels", "startDate", "dueDate", "source", "createdAt", "updatedAt"];
export const ACTIVITY_COLS = ["id", "timestamp", "actor", "action", "projectId", "issueId", "issueTitle", "detail"];

export const DATASET_META: Record<string, { cols: string[]; title: string }> = {
  projects: { cols: PROJECT_COLS, title: "OmniProject — Projects" },
  issues: { cols: ISSUE_COLS, title: "OmniProject — Issues" },
  activity: { cols: ACTIVITY_COLS, title: "OmniProject — Activity" },
};

/** Coerce a value to a flat cell (arrays joined, objects JSON-stringified, null/undefined → ""). */
export function cell(value: unknown): CsvValue {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return value as CsvValue;
}

/** Flatten rows to a 2-D cell matrix in `cols` order — the header-aligned body for csv/md/pdf/xlsx. */
export function toMatrix(items: Row[], cols: string[]): CsvValue[][] {
  return items.map((item) => cols.map((c) => cell(item[c])));
}

export interface RenderableDataset {
  rows: Row[];
  cols: string[];
  title: string;
  base: string;
}

/** Format registry: extension → content type + serialiser. Adding a format is one entry. */
export const EXPORT_FORMATS: Record<string, { contentType: string; render: (d: RenderableDataset) => string | Buffer }> = {
  csv: { contentType: "text/csv; charset=utf-8", render: (d) => toCsv(d.cols, toMatrix(d.rows, d.cols)) },
  json: { contentType: "application/json; charset=utf-8", render: (d) => JSON.stringify(d.rows, null, 2) },
  md: { contentType: "text/markdown; charset=utf-8", render: (d) => toMarkdown(d.title, d.cols, toMatrix(d.rows, d.cols)) },
  pdf: { contentType: "application/pdf", render: (d) => buildPdf({ title: d.title, headers: d.cols, rows: toMatrix(d.rows, d.cols) }) },
};

/** Build the multi-sheet workbook over all three datasets (the .xlsx export). */
export function buildWorkbook(projects: Row[], issues: Row[], activity: Row[]): Buffer {
  const sheets: Sheet[] = [
    { name: "Projects", headers: PROJECT_COLS, rows: toMatrix(projects, PROJECT_COLS) },
    { name: "Issues", headers: ISSUE_COLS, rows: toMatrix(issues, ISSUE_COLS) },
    { name: "Activity", headers: ACTIVITY_COLS, rows: toMatrix(activity, ACTIVITY_COLS) },
  ];
  return buildXlsx(sheets);
}
