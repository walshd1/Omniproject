import { describe, it, expect } from "vitest";
import { resolveGridColumns, type GridColumnsDef } from "./grid-columns";
import { GRID_COLUMNS, type GridColumn } from "../components/grid/IssueGrid";
import type { StoredDef } from "./defs";

/**
 * The pure grid-columns resolver (roadmap X.7): the winning `gridColumns` def replaces the built-in column
 * catalogue; absent/empty/all-invalid falls back to `GRID_COLUMNS`, so the grid is never blank.
 */

function def(storage: string, columns: unknown, over: Partial<StoredDef> = {}): StoredDef & { payload: GridColumnsDef } {
  return {
    id: `${storage}-cols`, kind: "gridColumns", name: "Grid columns", storage,
    createdBy: "u1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    rowVersion: 1, payload: { id: "default", columns: columns as GridColumnsDef["columns"] }, ...over,
  };
}
const fields = (cols: readonly GridColumn[]) => cols.map((c) => c.field);

describe("resolveGridColumns", () => {
  it("returns the built-in default when no def resolves", () => {
    expect(resolveGridColumns(GRID_COLUMNS, undefined)).toBe(GRID_COLUMNS);
    expect(resolveGridColumns(GRID_COLUMNS, [])).toBe(GRID_COLUMNS);
  });

  it("a resolved def REPLACES the built-in catalogue (order preserved)", () => {
    const d = def("org", [
      { field: "status", label: "State", type: "status" },
      { field: "title", label: "Name", type: "text" },
    ]);
    expect(fields(resolveGridColumns(GRID_COLUMNS, [d]))).toEqual(["status", "title"]);
  });

  it("most-specific scope wins (user over org)", () => {
    const org = def("org", [{ field: "title", label: "Org", type: "text" }]);
    const user = def("user", [{ field: "status", label: "User", type: "status" }]);
    expect(fields(resolveGridColumns(GRID_COLUMNS, [org, user]))).toEqual(["status"]);
  });

  it("newest wins on a scope tie", () => {
    const older = def("org", [{ field: "title", label: "Old", type: "text" }], { updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = def("org", [{ field: "status", label: "New", type: "status" }], { updatedAt: "2026-06-01T00:00:00.000Z" });
    expect(fields(resolveGridColumns(GRID_COLUMNS, [older, newer]))).toEqual(["status"]);
  });

  it("drops malformed columns; an all-invalid payload falls back to the built-in", () => {
    const mixed = def("org", [
      { field: "title", label: "Title", type: "text" },
      { field: "", label: "no field", type: "text" },
      { field: "x", label: "bad type", type: "bogus" },
      { field: "y", type: "text" },
    ]);
    expect(fields(resolveGridColumns(GRID_COLUMNS, [mixed]))).toEqual(["title"]);
    const allBad = def("org", [{ field: "x", label: "y", type: "bogus" }]);
    expect(resolveGridColumns(GRID_COLUMNS, [allBad])).toBe(GRID_COLUMNS);
  });
});
