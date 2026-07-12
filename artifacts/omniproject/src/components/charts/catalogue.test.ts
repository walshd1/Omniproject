import { describe, it, expect } from "vitest";
import { PRIMITIVE_CATALOGUE, getPrimitive, primitivesByCategory, chartPrimitives } from "./catalogue";
import type { ChartViewSpec } from "./ChartView";

// Every chart type the common renderer dispatches. If ChartView gains a type, this list and the
// catalogue must both grow — the coverage test below fails until a matching entry exists.
const CHART_VIEW_TYPES: ChartViewSpec["type"][] = ["bar", "line", "area", "pie", "donut", "scatter", "treemap", "gantt"];

describe("primitive catalogue", () => {
  it("has a unique id for every primitive", () => {
    const ids = PRIMITIVE_CATALOGUE.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every ChartView chart type with exactly one entry", () => {
    for (const type of CHART_VIEW_TYPES) {
      const matches = PRIMITIVE_CATALOGUE.filter((p) => p.chartType === type);
      expect(matches.length, `catalogue entry for chartType ${type}`).toBe(1);
    }
  });

  it("does not reference a chartType ChartView cannot render", () => {
    for (const p of chartPrimitives()) {
      expect(CHART_VIEW_TYPES).toContain(p.chartType!);
    }
  });

  it("gives every primitive a label, description, and at least one required param", () => {
    for (const p of PRIMITIVE_CATALOGUE) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.description.length, p.id).toBeGreaterThan(0);
      expect(p.params.some((param) => param.required), `${p.id} has a required param`).toBe(true);
    }
  });

  it("declares options for every enum param", () => {
    for (const p of PRIMITIVE_CATALOGUE) {
      for (const param of p.params) {
        if (param.type === "enum") expect(param.options?.length, `${p.id}.${param.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("looks up by id and filters by category", () => {
    expect(getPrimitive("gantt")?.label).toBe("Gantt chart");
    expect(getPrimitive("nope")).toBeUndefined();
    expect(primitivesByCategory("tile").map((p) => p.id).sort()).toEqual(["badge", "stat-tile"]);
    expect(chartPrimitives().length).toBe(CHART_VIEW_TYPES.length);
  });
});
