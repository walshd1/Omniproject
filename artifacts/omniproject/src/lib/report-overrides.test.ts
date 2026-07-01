import { describe, it, expect } from "vitest";
import type { ReportDefinition } from "@workspace/backend-catalogue";
import { mergeReportOverrides } from "./report-overrides";

const def = (id: string, label: string, order: number): ReportDefinition => ({
  id, label, order, docsUrl: "", kind: "portfolio", tools: [],
  capabilities: { requiresCapability: null, timeSeries: false, exports: [] },
  renderer: { engine: "builtin", component: "X" },
});

const catalogue = [def("a", "Alpha", 30), def("b", "Bravo", 10), def("c", "Cad", 20)];

describe("mergeReportOverrides", () => {
  it("applies label + order and sorts by effective order", () => {
    const merged = mergeReportOverrides(catalogue, [{ id: "a", order: 5, label: "Renamed" }]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]); // a now order 5 → first
    expect(merged.find((r) => r.id === "a")!.label).toBe("Renamed");
  });

  it("marks hidden and leaves others visible", () => {
    const merged = mergeReportOverrides(catalogue, [{ id: "b", hidden: true }]);
    expect(merged.find((r) => r.id === "b")!.hidden).toBe(true);
    expect(merged.find((r) => r.id === "a")!.hidden).toBe(false);
  });

  it("ignores a blank label override (keeps the catalogue label)", () => {
    const merged = mergeReportOverrides(catalogue, [{ id: "a", label: "  " }]);
    expect(merged.find((r) => r.id === "a")!.label).toBe("Alpha");
  });

  it("an override for an unknown id is a no-op", () => {
    const merged = mergeReportOverrides(catalogue, [{ id: "zzz", label: "ghost", hidden: true }]);
    expect(merged.map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(merged.every((r) => !r.hidden)).toBe(true);
  });
});
