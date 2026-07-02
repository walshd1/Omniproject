import { describe, it, expect } from "vitest";
import { runCustomReport, runCustomReportTrend, matchRow, metricLabel, type CustomReportDef } from "./custom-report";

const rows = [
  { status: "done", budget: 100, region: "EU" },
  { status: "done", budget: 50, region: "US" },
  { status: "todo", budget: 200, region: "EU" },
];

function def(over: Partial<CustomReportDef> = {}): CustomReportDef {
  return { id: "r", label: "R", scope: "project", groupBy: "status", metrics: [{ id: "m", field: "budget", agg: "sum" }], viz: "table", ...over };
}

describe("runCustomReport", () => {
  it("groups by a field and aggregates the metric, with a grand total", () => {
    const res = runCustomReport(def(), rows);
    expect(res.matched).toBe(3);
    const done = res.groups.find((g) => g.key === "done")!;
    expect(done.cells["m"]).toBe(150); // 100 + 50
    expect(res.grand["m"]).toBe(350);
  });

  it("applies the filter predicate before grouping", () => {
    const res = runCustomReport(def({ filter: { all: [{ field: "region", op: "eq", value: "EU" }] } }), rows);
    expect(res.matched).toBe(2); // only EU rows
    expect(res.grand["m"]).toBe(300); // 100 + 200
  });

  it("supports count (ignores the field) and avg/min/max", () => {
    const res = runCustomReport(def({ groupBy: "", metrics: [
      { id: "c", field: "budget", agg: "count" },
      { id: "a", field: "budget", agg: "avg" },
      { id: "mx", field: "budget", agg: "max" },
    ] }), rows);
    const all = res.groups[0]!;
    expect(all.cells["c"]).toBe(3);
    expect(all.cells["a"]).toBeCloseTo(350 / 3);
    expect(all.cells["mx"]).toBe(200);
  });

  it("matchRow handles numeric ops and missing fields safely", () => {
    expect(matchRow({ all: [{ field: "budget", op: "gt", value: 150 }] }, { budget: 200 })).toBe(true);
    expect(matchRow({ all: [{ field: "budget", op: "gt", value: 150 }] }, { budget: 10 })).toBe(false);
    expect(matchRow({ all: [{ field: "missing", op: "gt", value: 0 }] }, { budget: 1 })).toBe(false);
  });

  // backlog #132: gt/gte/lt/lte fall back to a date-aware comparison when a field isn't numeric —
  // needed so a drill-through predicate can express "dueDate < today" against Issue.dueDate (an ISO
  // date string, not a number).
  it("matchRow falls back to date comparison for non-numeric (ISO date) fields", () => {
    expect(matchRow({ all: [{ field: "dueDate", op: "lt", value: "2026-01-01" }] }, { dueDate: "2025-06-01" })).toBe(true);
    expect(matchRow({ all: [{ field: "dueDate", op: "lt", value: "2026-01-01" }] }, { dueDate: "2026-06-01" })).toBe(false);
    expect(matchRow({ all: [{ field: "dueDate", op: "gte", value: "2026-01-01" }] }, { dueDate: "2026-01-01" })).toBe(true);
  });

  it("matchRow's date fallback never fires for genuinely numeric comparisons", () => {
    // A numeric literal must not be reinterpreted as a date — it always resolves via asNum first.
    expect(matchRow({ all: [{ field: "budget", op: "lt", value: 100 }] }, { budget: 50 })).toBe(true);
    expect(matchRow({ all: [{ field: "budget", op: "lt", value: 100 }] }, { budget: 150 })).toBe(false);
  });

  it("matchRow's date fallback is false when either side isn't a parsable date", () => {
    expect(matchRow({ all: [{ field: "dueDate", op: "lt", value: "2026-01-01" }] }, { dueDate: "not-a-date" })).toBe(false);
    expect(matchRow({ all: [{ field: "dueDate", op: "lt", value: "not-a-date" }] }, { dueDate: "2025-06-01" })).toBe(false);
  });

  it("metricLabel falls back to a readable default", () => {
    expect(metricLabel({ id: "m", field: "budget", agg: "sum" })).toBe("Sum of budget");
    expect(metricLabel({ id: "m", field: "x", agg: "count" })).toBe("Count");
    expect(metricLabel({ id: "m", field: "x", agg: "sum", label: "Spend" })).toBe("Spend");
  });

  describe("groupBy2 (pivot)", () => {
    it("produces a cross-tab: rows for groupBy, columns for groupBy2, both levels visible", () => {
      const res = runCustomReport(def({ groupBy2: "region" }), rows);
      expect(res.columns).toEqual(["EU", "US"]); // distinct region values, sorted
      const done = res.groups.find((g) => g.key === "done")!;
      // done×EU = 100, done×US = 50 — a genuine per-cell breakdown, not a compound key.
      expect(done.pivot?.["EU"]?.cells["m"]).toBe(100);
      expect(done.pivot?.["US"]?.cells["m"]).toBe(50);
      expect(done.cells["m"]).toBe(150); // row total unchanged
      const todo = res.groups.find((g) => g.key === "todo")!;
      expect(todo.pivot?.["EU"]?.cells["m"]).toBe(200);
      expect(todo.pivot?.["US"]?.cells["m"]).toBe(0); // no todo×US rows — filled as 0, not omitted
      expect(todo.pivot?.["US"]?.count).toBe(0);
    });

    it("columns span every distinct groupBy2 value across ALL rows, not just this row's own values", () => {
      const res = runCustomReport(def({ groupBy2: "region" }), rows);
      for (const g of res.groups) expect(Object.keys(g.pivot!).sort()).toEqual(["EU", "US"]);
    });

    it("is a no-op without groupBy (groupBy2 alone doesn't pivot)", () => {
      const res = runCustomReport(def({ groupBy: "", groupBy2: "region" }), rows);
      expect(res.columns).toBeUndefined();
      expect(res.groups[0]!.pivot).toBeUndefined();
    });
  });

  describe("runCustomReportTrend", () => {
    const dated = [
      { budget: 100, closedAt: "2026-01-15" },
      { budget: 50, closedAt: "2026-01-20" },
      { budget: 200, closedAt: "2026-02-01" },
      { budget: 10, closedAt: "not-a-date" },
      { budget: 5 }, // missing date entirely
    ];

    function trendDef(over: Partial<CustomReportDef> = {}): CustomReportDef {
      return { id: "t", label: "T", scope: "project", metrics: [{ id: "m", field: "budget", agg: "sum" }], viz: "line", dateField: "closedAt", ...over };
    }

    it("buckets rows by month and aggregates the metric, chronologically ascending", () => {
      const res = runCustomReportTrend(trendDef(), dated);
      expect(res.points.map((p) => p.period)).toEqual(["2026-01", "2026-02"]);
      expect(res.points[0]!.label).toBe("Jan 2026");
      expect(res.points[0]!.cells["m"]).toBe(150); // 100 + 50
      expect(res.points[1]!.cells["m"]).toBe(200);
    });

    it("skips rows with an unparseable or missing date, and totals only the dated ones", () => {
      const res = runCustomReportTrend(trendDef(), dated);
      expect(res.matched).toBe(3); // 5 rows minus the bad-date and missing-date ones
      expect(res.grand["m"]).toBe(350);
    });

    it("applies the filter before bucketing", () => {
      const res = runCustomReportTrend(trendDef({ filter: { all: [{ field: "budget", op: "gt", value: 60 }] } }), dated);
      expect(res.matched).toBe(2); // 100 and 200 only
      expect(res.points.map((p) => p.cells["m"])).toEqual([100, 200]);
    });

    it("returns no points without a dateField configured", () => {
      const res = runCustomReportTrend(trendDef({ dateField: undefined }), dated);
      expect(res.points).toEqual([]);
      expect(res.matched).toBe(0);
    });
  });
});
