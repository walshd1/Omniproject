import { useResolvedDefs, type StoredDef } from "./defs";
import type { GridColumn } from "../components/grid/IssueGrid";

/**
 * The editable issue grid's COLUMN CATALOGUE as a JSON-defined artifact (roadmap X.7). The column set is no
 * longer hardcoded: an org (or project/user) authors a `gridColumns` def through the importer — the one
 * validated write-path into the scoped encrypted stores (roadmap X.10) — and the grid renders over it. The def
 * lists WHICH advertised fields to show/edit and in what order; it never carries issue data (the stateless-lens
 * invariant), columns still intersect with backend availability at render, and saved-views stay the per-user
 * narrowing layer on top.
 */

/** The type-only import above erases at runtime, so this module and IssueGrid don't form a runtime cycle. */

/** A grid-columns def payload: an id + an ordered `columns` list. Loose field/label/type strings as they arrive
 *  from JSON; {@link resolveGridColumns} drops any malformed entry before it reaches the renderer. */
export interface GridColumnsDef {
  id: string;
  columns: Array<{ field: string; label: string; type: string }>;
}

/** The grid's cell renderers — the closed set a column `type` may name (mirrors `ColType` in IssueGrid and the
 *  server-side `validateGridColumnsDef`). */
const GRID_COLUMN_TYPES: ReadonlySet<string> = new Set(["text", "status", "priority", "date", "number"]);

/** Scope precedence when more than one grid-columns def resolves: most-specific wins (user > project >
 *  programme > org > system), mirroring the screen-def resolution order. */
const SCOPE_RANK: Record<string, number> = { user: 4, project: 3, programme: 2, org: 1, system: 0 };
const rankOf = (storage: string): number => SCOPE_RANK[storage] ?? 0;

function isValidColumn(c: unknown): c is GridColumn {
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o["field"] === "string" && !!o["field"].trim() &&
    typeof o["label"] === "string" && !!o["label"].trim() &&
    typeof o["type"] === "string" && GRID_COLUMN_TYPES.has(o["type"])
  );
}

/**
 * The ACTIVE grid-columns catalogue: the winning grid-columns def (most-specific scope, newest on a tie)
 * REPLACES the built-in default; when no def resolves — the common case (importer off, or none authored) — the
 * built-in `GRID_COLUMNS` stands. Malformed columns are dropped, and an all-invalid/empty payload falls back to
 * the built-in so the grid is never blank. Pure.
 */
export function resolveGridColumns(
  builtin: readonly GridColumn[],
  resolved: ReadonlyArray<StoredDef & { payload: GridColumnsDef }> | undefined,
): readonly GridColumn[] {
  if (!Array.isArray(resolved) || resolved.length === 0) return builtin;
  // Null-safe throughout: a malformed row (wrong storage/updatedAt/payload) sorts to a rank of 0 and yields no
  // valid columns, so it degrades to the built-in default rather than throwing.
  const winner = [...resolved].sort(
    (a, b) => rankOf(b?.storage ?? "") - rankOf(a?.storage ?? "") || String(b?.updatedAt ?? "").localeCompare(String(a?.updatedAt ?? "")),
  )[0];
  const cols = winner?.payload?.columns;
  const valid = Array.isArray(cols) ? cols.filter(isValidColumn) : [];
  return valid.length ? valid : builtin;
}

/** The resolved grid-columns defs for the caller (aggregated across scopes), typed. Empty/undefined when the
 *  importer is off or none are authored — {@link resolveGridColumns} then keeps the built-in default. */
export function useResolvedGridColumns(projectId?: string) {
  return useResolvedDefs<GridColumnsDef>("gridColumns", projectId);
}
