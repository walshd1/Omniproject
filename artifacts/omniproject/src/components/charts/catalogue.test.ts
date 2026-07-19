import { describe, it, expect } from "vitest";
import { PRIMITIVE_CATALOGUE, getPrimitive, primitivesByCategory, chartPrimitives } from "./catalogue";
import { resolvePrimitive, rootPrimitives } from "@workspace/backend-catalogue";
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

  it("gives every primitive a label, description, and at least one required param (after composition)", () => {
    // The render-surface SPINE (canvas ← geometry-canvas ← chart ← interactive-chart) are ABSTRACT
    // composition bases — never instantiated directly by the builder, so they legitimately expose only
    // optional params; concrete descendants get their required params from their own data shape.
    const ABSTRACT_BASES = new Set(["canvas", "geometry-canvas", "chart", "interactive-chart"]);
    for (const p of PRIMITIVE_CATALOGUE) {
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.description.length, p.id).toBeGreaterThan(0);
      if (ABSTRACT_BASES.has(p.id)) continue;
      // A thin child may add only optional params but INHERITS its parent's required ones — so check the
      // RESOLVED def, which is what the builder consumes.
      const resolved = resolvePrimitive(p.id)!;
      expect(resolved.params.some((param) => param.required), `${p.id} (resolved) has a required param`).toBe(true);
    }
  });

  it("composition: extends resolves property-by-property with a traceable lineage (data-slot ← register ← table)", () => {
    const ds = resolvePrimitive("data-slot")!;
    expect(ds.lineage).toEqual(["data-slot", "register", "table"]);
    // Fields trace back to the def that supplied them: columns from table, an editable prop from register,
    // and the one it adds/alters (slot, now required) from data-slot itself.
    expect(ds.provenance["columns"]).toBe("table");
    expect(ds.provenance["collection"]).toBe("register");
    expect(ds.provenance["slot"]).toBe("data-slot");
    expect(ds.params.find((p) => p.key === "slot")?.required).toBe(true); // the child ALTERS slot → required
    // Roots are few and generic — register/data-slot are NOT roots.
    const rootIds = rootPrimitives().map((r) => r.id);
    expect(rootIds).not.toContain("register");
    expect(rootIds).not.toContain("data-slot");
    expect(rootIds).toContain("table");
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
