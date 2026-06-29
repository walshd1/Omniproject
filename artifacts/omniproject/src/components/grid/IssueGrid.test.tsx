import { describe, it, expect } from "vitest";
import { visibleGridColumns, coerceCellValue, buildIssueUpdate, GRID_COLUMNS } from "./IssueGrid";
import type { Availability } from "../../lib/availability";

describe("IssueGrid helpers", () => {
  it("visibleGridColumns gates columns by availability.fields", () => {
    const avail: Availability = {
      source: "capabilities",
      fields: ["title", "status"],
      available: ["title", "status", "dueDate"],
      hidden: ["dueDate"],
      tables: [],
      relationships: [],
    };
    expect(visibleGridColumns(avail).map((c) => c.field)).toEqual(["title", "status"]);
  });

  it("visibleGridColumns shows all columns while availability is still loading", () => {
    expect(visibleGridColumns(undefined).length).toBe(GRID_COLUMNS.length);
  });

  it("coerceCellValue types values and maps empty to null", () => {
    expect(coerceCellValue("number", "5")).toBe(5);
    expect(coerceCellValue("number", "")).toBe(null);
    expect(coerceCellValue("date", "")).toBe(null);
    expect(coerceCellValue("date", "2026-01-02")).toBe("2026-01-02");
    expect(coerceCellValue("text", "  hi  ")).toBe("hi");
  });

  it("buildIssueUpdate binds expectedVersion only when a version is present", () => {
    expect(buildIssueUpdate("status", "done", 3)).toEqual({ status: "done", expectedVersion: 3 });
    expect(buildIssueUpdate("status", "done", null)).toEqual({ status: "done" });
    expect(buildIssueUpdate("storyPoints", 8, undefined)).toEqual({ storyPoints: 8 });
  });
});
