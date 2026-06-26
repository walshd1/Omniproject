import { describe, it, expect } from "vitest";
import {
  isPresent,
  fieldCompleteness,
  overallCompleteness,
  sourceBreakdown,
  toCsv,
} from "./data-lineage";

describe("isPresent", () => {
  it("treats null/undefined/blank/empty-array as absent", () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent("  ")).toBe(false);
    expect(isPresent([])).toBe(false);
  });
  it("treats 0, false and non-empty values as present", () => {
    expect(isPresent(0)).toBe(true); // a £0 budget is a real value
    expect(isPresent(false)).toBe(true); // blocked=false is a real value
    expect(isPresent("x")).toBe(true);
    expect(isPresent([1])).toBe(true);
  });
});

const ROWS = [
  { id: "a", budget: 100, earnedValue: 50, source: "jira" },
  { id: "b", budget: 0, earnedValue: null, source: "jira" },
  { id: "c", budget: null, earnedValue: null, source: "openproject" },
];
const FIELDS = [
  { key: "budget", label: "Budget" },
  { key: "earnedValue", label: "Earned value" },
];

describe("fieldCompleteness", () => {
  it("counts present cells per field (0 counts, null does not)", () => {
    const fc = fieldCompleteness(ROWS, FIELDS);
    const budget = fc.find((f) => f.key === "budget")!;
    expect(budget.present).toBe(2); // 100 and 0
    expect(budget.pct).toBe(67); // 2/3
    const ev = fc.find((f) => f.key === "earnedValue")!;
    expect(ev.present).toBe(1); // only row a
    expect(ev.pct).toBe(33);
  });
});

describe("overallCompleteness", () => {
  it("is populated cells over rows × fields", () => {
    const o = overallCompleteness(ROWS, FIELDS);
    expect(o.total).toBe(6); // 3 rows × 2 fields
    expect(o.present).toBe(3); // budget:2 + ev:1
    expect(o.pct).toBe(50);
  });
  it("is 0% safely for no rows", () => {
    expect(overallCompleteness([], FIELDS).pct).toBe(0);
  });
});

describe("sourceBreakdown", () => {
  it("groups by source, biggest first", () => {
    const b = sourceBreakdown(ROWS);
    expect(b).toEqual([
      { source: "jira", count: 2 },
      { source: "openproject", count: 1 },
    ]);
  });
  it("buckets missing source as 'unknown' and supports a custom accessor", () => {
    const b = sourceBreakdown([{ p: "sample" }, { p: null }], (r) => r["p"]);
    expect(b).toEqual([
      { source: "sample", count: 1 },
      { source: "unknown", count: 1 },
    ]);
  });
});

describe("toCsv", () => {
  it("emits a label header and escapes commas/quotes/newlines", () => {
    const csv = toCsv(
      [{ name: "A, Inc", note: 'say "hi"', tags: ["x", "y"] }],
      [
        { key: "name", label: "Name" },
        { key: "note", label: "Note" },
        { key: "tags", label: "Tags" },
      ],
    );
    const [header, row] = csv.split("\n");
    expect(header).toBe("Name,Note,Tags");
    expect(row).toBe('"A, Inc","say ""hi""",x; y');
  });
});
