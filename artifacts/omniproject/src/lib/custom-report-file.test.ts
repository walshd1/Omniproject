import { describe, it, expect, vi } from "vitest";
import { parseReportDef, uniqueReportId, reportDefToJson, downloadJson, downloadReportDef, readReportDefFile } from "./custom-report-file";
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
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "donut", metrics: [{ field: "a", agg: "sum" }] })).toThrow(/viz/);
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "bar", metrics: [{ field: "a", agg: "median" }] })).toThrow(/agg/);
    expect(() => parseReportDef({ label: "x", scope: "project", viz: "bar", metrics: [] })).toThrow(/metric/);
    expect(() => parseReportDef({ scope: "project", viz: "bar", metrics: [{ field: "a", agg: "sum" }] })).toThrow(/label/);
  });

  it("rejects a non-object", () => {
    expect(() => parseReportDef(42)).toThrow(/report definition/);
  });

  it("round-trips a presentation style, keeping only known safe fields", () => {
    const styled: CustomReportDef = { ...valid, style: { title: "Budget", fontFamily: "serif", textColor: "#123456", background: "#eee", align: "center" } };
    expect(parseReportDef(JSON.parse(reportDefToJson(styled)))).toEqual(styled);

    // Unknown font / stray fields are dropped; a title-only style survives.
    const cleaned = parseReportDef({ ...valid, style: { title: "Just a title", fontFamily: "comic-sans", evil: "x" } });
    expect(cleaned.style).toEqual({ title: "Just a title" });

    // An empty/garbage style becomes no style at all.
    expect(parseReportDef({ ...valid, style: {} }).style).toBeUndefined();
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

  it("falls back to 'report' when the label slugifies to nothing", () => {
    expect(uniqueReportId({ ...valid, id: "", label: "!!!" }, [])).toBe("report");
  });

  it("strips leading/trailing separators from a minted slug", () => {
    expect(uniqueReportId({ ...valid, id: "", label: "  Q1 Spend!  " }, [])).toBe("q1-spend");
  });
});

describe("parseMetric (via parseReportDef)", () => {
  const base = { label: "R", scope: "project", viz: "table" } as const;

  it("keeps an explicit metric id and label", () => {
    const def = parseReportDef({ ...base, metrics: [{ id: "cost", field: "actualCost", agg: "sum", label: "Cost" }] });
    expect(def.metrics[0]).toEqual({ id: "cost", field: "actualCost", agg: "sum", label: "Cost" });
  });

  it("mints a positional id (m1, m2) when a metric omits one, and drops a blank label", () => {
    const def = parseReportDef({ ...base, metrics: [{ field: "a", agg: "sum" }, { field: "b", agg: "avg", label: "   " }] });
    expect(def.metrics[0]!.id).toBe("m1");
    expect(def.metrics[1]!.id).toBe("m2");
    expect(def.metrics[1]!.label).toBeUndefined();
  });

  it("throws when a metric isn't an object", () => {
    expect(() => parseReportDef({ ...base, metrics: [null] })).toThrow(/metric 1 is not an object/);
    expect(() => parseReportDef({ ...base, metrics: ["x"] })).toThrow(/metric 1 is not an object/);
  });

  it("throws when a metric has no field or a blank field", () => {
    expect(() => parseReportDef({ ...base, metrics: [{ agg: "sum" }] })).toThrow(/metric 1 needs a "field"/);
    expect(() => parseReportDef({ ...base, metrics: [{ field: "   ", agg: "sum" }] })).toThrow(/metric 1 needs a "field"/);
  });

  it("names the offending metric position in an invalid-agg error", () => {
    expect(() => parseReportDef({ ...base, metrics: [{ field: "a", agg: "sum" }, { field: "b", agg: "nope" }] })).toThrow(/metric 2 has an invalid "agg" \(nope\)/);
  });
});

describe("parseStyle (via parseReportDef) — every field branch", () => {
  it("keeps subtitle and align:left", () => {
    const def = parseReportDef({ ...valid, style: { subtitle: "Sub", align: "left" } });
    expect(def.style).toEqual({ subtitle: "Sub", align: "left" });
  });

  it("drops an unknown align value", () => {
    const def = parseReportDef({ ...valid, style: { title: "T", align: "right" } });
    expect(def.style).toEqual({ title: "T" });
  });

  it("truncates over-long title/subtitle to 200 and colours to 64 chars", () => {
    const def = parseReportDef({ ...valid, style: { title: "t".repeat(300), subtitle: "s".repeat(300), textColor: "c".repeat(100), background: "b".repeat(100) } });
    expect(def.style!.title).toHaveLength(200);
    expect(def.style!.subtitle).toHaveLength(200);
    expect(def.style!.textColor).toHaveLength(64);
    expect(def.style!.background).toHaveLength(64);
  });

  it("ignores a non-object style", () => {
    expect(parseReportDef({ ...valid, style: 42 }).style).toBeUndefined();
    expect(parseReportDef({ ...valid, style: null }).style).toBeUndefined();
  });
});

describe("parseReportDef — chart / filter / optional fields", () => {
  const base = { label: "R", scope: "project", viz: "bar", metrics: [{ field: "a", agg: "sum" }] } as const;

  it("keeps only boolean chart options and drops a chart with none", () => {
    expect(parseReportDef({ ...base, chart: { stacked: true, legend: false } }).chart).toEqual({ stacked: true, legend: false });
    expect(parseReportDef({ ...base, chart: { stacked: "yes", legend: 1 } }).chart).toBeUndefined();
    expect(parseReportDef({ ...base, chart: {} }).chart).toBeUndefined();
  });

  it("ignores a non-object chart", () => {
    expect(parseReportDef({ ...base, chart: 5 }).chart).toBeUndefined();
  });

  it("keeps a filter object and ignores a non-object filter", () => {
    expect(parseReportDef({ ...base, filter: { all: [] } }).filter).toEqual({ all: [] });
    expect(parseReportDef({ ...base, filter: "x" }).filter).toBeUndefined();
  });

  it("defaults a missing id to empty string", () => {
    expect(parseReportDef(base).id).toBe("");
  });
});

describe("download + read round-trip", () => {
  function captureDownload() {
    const files: string[] = [];
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    const spy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      files.push(this.download);
    });
    return { files, restore: () => { spy.mockRestore(); vi.unstubAllGlobals(); } };
  }

  it("downloadJson names the file exactly as given", () => {
    const { files, restore } = captureDownload();
    try {
      downloadJson({ a: 1 }, "thing.json");
      expect(files).toEqual(["thing.json"]);
    } finally {
      restore();
    }
  });

  it("downloadReportDef defaults the filename by single-vs-array and honours an override", () => {
    const { files, restore } = captureDownload();
    try {
      downloadReportDef(valid);
      downloadReportDef({ ...valid, id: "" });
      downloadReportDef([valid, valid]);
      downloadReportDef(valid, "custom.json");
      expect(files).toEqual(["report-spend.json", "report-definition.json", "custom-reports.json", "custom.json"]);
    } finally {
      restore();
    }
  });

  it("reportDefToJson emits pretty (2-space) JSON", () => {
    expect(reportDefToJson(valid)).toBe(JSON.stringify(valid, null, 2));
    expect(reportDefToJson(valid)).toContain("\n  ");
  });

  it("readReportDefFile parses a single definition file", async () => {
    const file = new File([reportDefToJson(valid)], "r.json", { type: "application/json" });
    const list = await readReportDefFile(file);
    expect(list).toEqual([valid]);
  });

  it("readReportDefFile parses an array-of-definitions file", async () => {
    const file = new File([JSON.stringify([valid, { ...valid, id: "spend2" }])], "rs.json");
    const list = await readReportDefFile(file);
    expect(list.map((d) => d.id)).toEqual(["spend", "spend2"]);
  });

  it("readReportDefFile rejects a file that isn't valid JSON", async () => {
    const file = new File(["{not json"], "bad.json");
    await expect(readReportDefFile(file)).rejects.toThrow(/valid JSON/);
  });

  it("readReportDefFile surfaces a per-definition validation error", async () => {
    const file = new File([JSON.stringify([{ label: "x", scope: "nope", viz: "bar", metrics: [{ field: "a", agg: "sum" }] }])], "bad.json");
    await expect(readReportDefFile(file)).rejects.toThrow(/scope/);
  });
});
