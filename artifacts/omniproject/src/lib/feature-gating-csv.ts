import type { ScopeFeatureConfig } from "./features";
import { triggerBlobDownload } from "./setup";

/**
 * Bulk feature-gating CSV — round-trips `settings.programmeFeatures` / `projectFeatures` (see
 * FeatureGovernance.tsx, the one-at-a-time admin UI this is additive to) through a spreadsheet so a PMO
 * can apply the same gating profile to dozens/hundreds of programmes/projects at once instead of one
 * form edit per scope. Pure (parse/serialise/diff only) — no fetch, no React; mirrors the shape of
 * lib/custom-report-file.ts (the existing import/export idiom for the report generator).
 *
 * File shape: one row per programme/project, one column per gating dimension (disabled/required/
 * forbidden), catalogue ids within a cell separated by "|" (ids never contain a pipe; commas are common
 * in nothing here, but the serializer still RFC-4180-quotes defensively). `scopeName` is informational
 * only — never read back on import, so renaming a programme/project between export and import can't
 * desync anything.
 */

export type GatingScopeType = "programme" | "project";

/** One row of the bulk gating CSV — a scope's full disable/require/forbid policy. */
export interface ScopeGatingRow {
  scopeType: GatingScopeType;
  scopeId: string;
  /** Informational only (not read back on import). */
  scopeName: string;
  disabled: string[];
  required: string[];
  forbidden: string[];
}

export const FEATURE_GATING_CSV_HEADERS = ["scopeType", "scopeId", "scopeName", "disabled", "required", "forbidden"] as const;

/** Reserved object keys never accepted as a scope id (mirrors the server's PROTO_KEYS guard in routes/features.ts). */
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const ID_SEP = "|";

// ---------------------------------------------------------------------------
// Serialise (RFC 4180, mirroring api-server/src/lib/csv.ts's escaping rules —
// no shared package between the two apps, same situation as CustomReportDef).
// ---------------------------------------------------------------------------

function escapeCell(value: string): string {
  let s = value;
  // CSV-injection guard: neutralise a leading formula trigger before quoting, same as the
  // server-side exporter — this file is opened directly in Excel/Sheets by a human.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Serialise gating rows to CSV text (UTF-8 BOM prefixed, so Excel opens it correctly). */
export function featureGatingRowsToCsv(rows: readonly ScopeGatingRow[]): string {
  const lines = [FEATURE_GATING_CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push(
      [r.scopeType, r.scopeId, r.scopeName, r.disabled.join(ID_SEP), r.required.join(ID_SEP), r.forbidden.join(ID_SEP)]
        .map(escapeCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// Parse (RFC 4180 — handles quoted cells containing commas, quotes and embedded newlines).
// ---------------------------------------------------------------------------

/** Parse raw CSV text into rows of raw string cells. Strips a leading UTF-8 BOM if present. */
export function parseCsvText(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const len = src.length;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  while (i < len) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ",") { endCell(); i += 1; continue; }
    if (c === "\r") { i += 1; continue; }
    if (c === "\n") { endRow(); i += 1; continue; }
    cell += c;
    i += 1;
  }
  // Final cell/row, unless the file ended cleanly on a newline (nothing pending).
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------
// Validate + build rows
// ---------------------------------------------------------------------------

export interface RowIssue {
  /** 1-based line number in the file (header is line 1). */
  line: number;
  message: string;
}

export interface ParsedGatingRow extends ScopeGatingRow {
  line: number;
}

export interface ParseFeatureGatingCsvResult {
  rows: ParsedGatingRow[];
  /** Fatal per-row problems — that row is dropped, others still parse. */
  errors: RowIssue[];
  /** Non-fatal per-row problems (e.g. an unrecognised scope id) — the row is still returned. */
  warnings: RowIssue[];
}

export interface ParseFeatureGatingCsvOptions {
  /** Every valid catalogue id (features ∪ methodologies ∪ reports) — an id outside this set is malformed. */
  validFeatureIds: ReadonlySet<string>;
  knownProgrammeIds: ReadonlySet<string>;
  knownProjectIds: ReadonlySet<string>;
}

function splitIds(cell: string): string[] {
  return cell.split(ID_SEP).map((s) => s.trim()).filter(Boolean);
}

/** Parse + validate a bulk gating CSV. Unknown scope ids are a warning (still applied — the per-scope
 *  PUT route is the ownership authority); an unrecognised feature id, a scopeType that isn't
 *  programme|project, or a required+forbidden clash within the same row rejects only that row. */
export function parseFeatureGatingCsv(text: string, opts: ParseFeatureGatingCsvOptions): ParseFeatureGatingCsvResult {
  const table = parseCsvText(text);
  const rows: ParsedGatingRow[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  if (table.length === 0) return { rows, errors: [{ line: 1, message: "The file is empty." }], warnings };

  const header = table[0]!.map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const need = ["scopeType", "scopeId", "disabled", "required", "forbidden"];
  const missing = need.filter((n) => idx(n) === -1);
  if (missing.length > 0) {
    errors.push({ line: 1, message: `Missing column(s): ${missing.join(", ")}. Expected header: ${FEATURE_GATING_CSV_HEADERS.join(",")}` });
    return { rows, errors, warnings };
  }
  const iType = idx("scopeType"), iId = idx("scopeId"), iName = idx("scopeName"), iDis = idx("disabled"), iReq = idx("required"), iForb = idx("forbidden");

  for (let r = 1; r < table.length; r++) {
    const line = r + 1;
    const cells = table[r]!;
    // Skip a fully blank line (trailing newline artefact).
    if (cells.length === 1 && cells[0] === "") continue;
    const scopeType = (cells[iType] ?? "").trim();
    const scopeId = (cells[iId] ?? "").trim();
    const scopeName = iName >= 0 ? (cells[iName] ?? "").trim() : "";

    if (scopeType !== "programme" && scopeType !== "project") {
      errors.push({ line, message: `scopeType must be "programme" or "project" (got "${scopeType}").` });
      continue;
    }
    if (!scopeId || PROTO_KEYS.has(scopeId)) {
      errors.push({ line, message: "scopeId is required." });
      continue;
    }

    const malformed: string[] = [];
    const readIds = (cell: string | undefined): string[] => {
      const ids = splitIds(cell ?? "");
      for (const id of ids) if (!opts.validFeatureIds.has(id) && !malformed.includes(id)) malformed.push(id);
      return ids;
    };
    const disabled = readIds(cells[iDis]);
    const required = readIds(cells[iReq]);
    const forbidden = readIds(cells[iForb]);
    if (malformed.length) {
      // Report ALL bad ids at once (was: only the last) so the operator fixes them in one pass.
      const label = malformed.length === 1 ? "is not a known catalogue item" : "are not known catalogue items";
      errors.push({ line, message: `${malformed.map((m) => `"${m}"`).join(", ")} ${label} (feature/methodology/report id).` });
      continue;
    }
    const clash = required.find((id) => forbidden.includes(id));
    if (clash) {
      errors.push({ line, message: `"${clash}" cannot be both required and forbidden in the same row.` });
      continue;
    }

    const known = scopeType === "programme" ? opts.knownProgrammeIds : opts.knownProjectIds;
    if (!known.has(scopeId)) {
      warnings.push({ line, message: `"${scopeId}" isn't in the current ${scopeType} list — it will be attempted, but may be rejected as not owned/found.` });
    }

    rows.push({ line, scopeType, scopeId, scopeName, disabled, required, forbidden });
  }
  return { rows, errors, warnings };
}

// ---------------------------------------------------------------------------
// Export-side row building
// ---------------------------------------------------------------------------

const EMPTY_CFG: ScopeFeatureConfig = { disabled: [], required: [], forbidden: [] };

/** Build one export row per known programme/project (even ones with no override yet, so a PMO can fill
 *  in a blank spreadsheet rather than hand-typing every id) — includes the CURRENT config where one exists. */
export function buildFeatureGatingExportRows(
  programmes: readonly { id: string; name: string }[],
  projects: readonly { id: string; name: string }[],
  programmeFeatures: Record<string, ScopeFeatureConfig>,
  projectFeatures: Record<string, ScopeFeatureConfig>,
): ScopeGatingRow[] {
  const rows: ScopeGatingRow[] = [];
  for (const p of programmes) {
    const cfg = programmeFeatures[p.id] ?? EMPTY_CFG;
    rows.push({ scopeType: "programme", scopeId: p.id, scopeName: p.name, disabled: cfg.disabled, required: cfg.required, forbidden: cfg.forbidden });
  }
  for (const p of projects) {
    const cfg = projectFeatures[p.id] ?? EMPTY_CFG;
    rows.push({ scopeType: "project", scopeId: p.id, scopeName: p.name, disabled: cfg.disabled, required: cfg.required, forbidden: cfg.forbidden });
  }
  return rows;
}

/** Trigger a browser download of the gating CSV. */
export function downloadFeatureGatingCsv(rows: readonly ScopeGatingRow[], filename = "feature-gating.csv"): void {
  const blob = new Blob([featureGatingRowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  triggerBlobDownload(blob, filename);
}

// ---------------------------------------------------------------------------
// Diff (import preview)
// ---------------------------------------------------------------------------

export type RowDiffStatus = "new" | "changed" | "unchanged";

export interface DimensionDiff {
  added: string[];
  removed: string[];
}

export interface RowDiff {
  row: ParsedGatingRow;
  status: RowDiffStatus;
  disabled: DimensionDiff;
  required: DimensionDiff;
  forbidden: DimensionDiff;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

function dimensionDiff(next: readonly string[], prev: readonly string[]): DimensionDiff {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return { added: next.filter((x) => !prevSet.has(x)), removed: prev.filter((x) => !nextSet.has(x)) };
}

/** Diff one parsed row against the scope's CURRENT config (undefined ⇒ no override exists yet). */
export function diffGatingRow(row: ParsedGatingRow, current: ScopeFeatureConfig | undefined): RowDiff {
  const prev = current ?? EMPTY_CFG;
  const unchanged = sameSet(row.disabled, prev.disabled) && sameSet(row.required, prev.required) && sameSet(row.forbidden, prev.forbidden);
  const status: RowDiffStatus = unchanged ? "unchanged" : current === undefined ? "new" : "changed";
  return {
    row,
    status,
    disabled: dimensionDiff(row.disabled, prev.disabled),
    required: dimensionDiff(row.required, prev.required),
    forbidden: dimensionDiff(row.forbidden, prev.forbidden),
  };
}
