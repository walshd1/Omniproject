import { describe, it, expect } from "vitest";
import { parseReportDef, uniqueReportId, reportDefToJson } from "./custom-report-file";
import type { CustomReportDef } from "./custom-report";

const valid: CustomReportDef = {
  id: "spend", label: "Spend by programme", scope: "portfolio", groupBy: "programmeName",
  metrics: [{ id: "m1", field: "actualCost", agg: "sum", label: "Actual" }], viz: "bar",
  filter: { all: [{ field: "status", op: "ne", value: "done" }] },
};

describe("parseReportDef", () => {
  it("round-trips a valid definition through JSON", () => {
    expect(parseReportDef(JSON.parse(reportDefToJson(valid)))).toEqual(valid);
  });

  it("keeps groupBy/filter only when present", () => {
    const def = parseReportDef({ label: "Count", scope: "project", viz: "table", metrics: [{ field: "id", agg: "count" }] });
    expect(def.groupBy).toBeUndefined();
    expect(def.filter).toBeUndefined();
    expect(def.metrics[0]).toMatchObject({ id: "m1", field: "id", agg: "count" });
  });

  it("round-trips groupBy2 (pivot) and dateField (trend line)", () => {
    const pivot: CustomReportDef = { ...valid, groupBy2: "status" };
    expect(parseReportDef(JSON.parse(reportDefToJson(pivot)))).toEqual(pivot);

    const trend: CustomReportDef = { id: "t", label: "Trend", scope: "project", viz: "line", dateField: "closedAt", metrics: [{ id: "m1", field: "budget", agg: "sum" }] };
    expect(parseReportDef(JSON.parse(reportDefToJson(trend)))).toEqual(trend);
  });

  it("rejects a bad scope, viz, agg or empty metrics", () => {
    expect(() => parseReportDef({ label: "x", scope: "nope", viz: "table", metrics: [{ field: "a", agg: "sum" }] })).toThrow(/scope/);
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "pie", metrics: [{ field: "a", agg: "sum" }] })).toThrow(/viz/);
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "bar", metrics: [{ field: "a", agg: "median" }] })).toThrow(/agg/);
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "bar", metrics: [] })).toThrow(/metric/);
    expect(() => parseReportDef({ scope: "project", viz: "bar", metrics: [{ field: "a", agg: "sum" }] })).toThrow(/label/);
  });

  it("rejects a non-object", () => {
    expect(() => parseReportDef(42)).toThrow(/report definition/);
  });
});

describe("uniqueReportId", () => {
  it("keeps a free id", () => {
    expect(uniqueReportId(valid, ["other"])).toBe("spend");
  });
  it("appends -2, -3 on collision", () => {
    expect(uniqueReportId(valid, ["spend"])).toBe("spend-2");
    expect(uniqueReportId(valid, ["spend", "spend-2"])).toBe("spend-3");
  });
  it("mints a slug from the label when id is blank", () => {
    expect(uniqueReportId({ ...valid, id: "" }, [])).toBe("spend-by-programme");
  });
});
