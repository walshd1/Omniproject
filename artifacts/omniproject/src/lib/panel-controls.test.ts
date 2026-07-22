import { describe, it, expect } from "vitest";
import { applyControls, bucketPeriod, groupByOptions, defaultControlsState, distinctValues, sortOptions, type ControlsConfig } from "./panel-controls";

const rows = [
  { year: "2026", projectId: "p1", amount: 100, currency: "GBP", period: "2026-03" },
  { year: "2026", projectId: "p2", amount: 50, currency: "USD", period: "2026-06" },
  { year: "2027", projectId: "p1", amount: 200, currency: "GBP", period: "2027-01" },
];

const config: ControlsConfig = {
  groupBy: ["year", "projectId", "currency"],
  metricField: "amount",
  metricLabel: "Amount",
  aggs: ["sum", "avg", "count"],
  filters: ["currency"],
  period: { field: "period", buckets: ["year", "quarter", "month"] },
};

describe("panel-controls engine", () => {
  it("bucketPeriod coarsens a period label", () => {
    expect(bucketPeriod("2026-03", "year")).toBe("2026");
    expect(bucketPeriod("2026-03", "quarter")).toBe("2026-Q1");
    expect(bucketPeriod("2026-11", "quarter")).toBe("2026-Q4");
    expect(bucketPeriod("2026-03", "month")).toBe("2026-03");
    expect(bucketPeriod("2026-Q2", "quarter")).toBe("2026-Q2");
  });

  it("groupByOptions lists period buckets then configured dimensions; default picks the first", () => {
    const opts = groupByOptions(config).map((o) => o.value);
    expect(opts).toEqual(["period:year", "period:quarter", "period:month", "year", "projectId", "currency"]);
    expect(defaultControlsState(config).groupBy).toBe("period:year");
  });

  it("distinctValues returns sorted unique field values", () => {
    expect(distinctValues(rows, "currency")).toEqual(["GBP", "USD"]);
  });

  it("applies group + sum aggregation", () => {
    const r = applyControls(rows, config, { groupBy: "year", agg: "sum", filters: {} });
    expect(r.groupByField).toBe("year");
    expect(r.metricKey).toBe("amount");
    const byYear = Object.fromEntries(r.rows.map((x) => [x["year"], x["amount"]]));
    expect(byYear).toEqual({ "2026": 150, "2027": 200 });
  });

  it("filters rows before aggregating", () => {
    const r = applyControls(rows, config, { groupBy: "year", agg: "sum", filters: { currency: ["GBP"] } });
    const byYear = Object.fromEntries(r.rows.map((x) => [x["year"], x["amount"]]));
    expect(byYear).toEqual({ "2026": 100, "2027": 200 }); // USD row (2026/50) excluded
  });

  it("count aggregation keys on count", () => {
    const r = applyControls(rows, config, { groupBy: "currency", agg: "count", filters: {} });
    expect(r.metricKey).toBe("count");
    const byCur = Object.fromEntries(r.rows.map((x) => [x["currency"], x["count"]]));
    expect(byCur).toEqual({ GBP: 2, USD: 1 });
  });

  it("groups by a derived period bucket", () => {
    const r = applyControls(rows, config, { groupBy: "period:quarter", agg: "sum", filters: {} });
    expect(r.groupByField).toBe("period");
    const byQ = Object.fromEntries(r.rows.map((x) => [x["period"], x["amount"]]));
    expect(byQ).toEqual({ "2026-Q1": 100, "2026-Q2": 50, "2027-Q1": 200 });
  });
});

describe("panel-controls sort (shared column sort — dates + ordinal levels)", () => {
  const listRows = [
    { id: "a", priority: "low", due: "2026-03-01" },
    { id: "b", priority: "urgent", due: "2026-01-15" },
    { id: "c", priority: "medium", due: "2026-02-10" },
  ];

  it("sorts an ordinal column by internal level (not label) when the user picks it", () => {
    const cfg: ControlsConfig = { sortable: [{ field: "priority", kind: "priority" }] };
    const out = applyControls(listRows, cfg, { ...defaultControlsState(cfg), sort: { field: "priority", dir: "desc" } });
    expect(out.rows.map((r) => r["id"])).toEqual(["b", "c", "a"]); // urgent > medium > low
  });

  it("sorts a date column chronologically", () => {
    const cfg: ControlsConfig = { sortable: [{ field: "due", kind: "date" }] };
    const out = applyControls(listRows, cfg, { ...defaultControlsState(cfg), sort: { field: "due", dir: "asc" } });
    expect(out.rows.map((r) => r["id"])).toEqual(["b", "c", "a"]);
  });

  it("leaves rows in natural order when no sort is active, and lists sortable options", () => {
    const cfg: ControlsConfig = { sortable: [{ field: "priority", label: "Priority", kind: "priority" }] };
    expect(sortOptions(cfg)).toEqual([{ value: "priority", label: "Priority" }]);
    const out = applyControls(listRows, cfg, defaultControlsState(cfg));
    expect(out.rows.map((r) => r["id"])).toEqual(["a", "b", "c"]);
  });
});
