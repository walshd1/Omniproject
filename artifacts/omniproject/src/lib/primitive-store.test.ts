import { describe, it, expect } from "vitest";
import { PRIMITIVES, primitiveStore, primitivesByFamily, primitivesFor, getPrimitive } from "./primitive-store";
import { PANEL_RENDERERS } from "../components/screen/registry";
import { PRIMITIVE_LIBRARY } from "../definitions/primitives";
import { FORM_FIELD_TYPES, componentLibrary } from "@workspace/backend-catalogue";

/**
 * Drift guard for THE single primitive store. It binds each family back to its authoritative registry, so
 * the unified store can never silently diverge from what actually renders — a new panel kind, chart
 * primitive or form field type must appear in the store (and nothing phantom may).
 */
describe("primitive-store (single shared store)", () => {
  it("the panel family exactly matches the panel renderer registry", () => {
    const store = new Set(primitivesByFamily("panel").map((p) => p.id));
    const registry = new Set(Object.keys(PANEL_RENDERERS));
    expect(store).toEqual(registry);
  });

  it("the viz family exactly matches the chart primitive library", () => {
    const store = primitivesByFamily("viz").map((p) => p.id).sort();
    const lib = PRIMITIVE_LIBRARY.map((p) => p.id).sort();
    expect(store).toEqual(lib);
  });

  it("the field family exactly matches the shared form field types", () => {
    const store = primitivesByFamily("field").map((p) => p.id).sort();
    expect(store).toEqual([...FORM_FIELD_TYPES].sort());
  });

  it("the component family exactly matches the shared component library", () => {
    const store = primitivesByFamily("component").map((p) => p.id).sort();
    const lib = componentLibrary().map((c) => c.id).sort();
    expect(store).toEqual(lib);
  });

  it("ids are unique within each family", () => {
    for (const family of ["panel", "viz", "field", "component"] as const) {
      const ids = primitivesByFamily(family).map((p) => p.id);
      expect(new Set(ids).size, `family ${family}`).toBe(ids.length);
    }
  });

  it("primitivesFor filters by placement surface", () => {
    expect(primitivesFor("form").every((p) => p.family === "field")).toBe(true);
    expect(primitivesFor("screen").some((p) => p.family === "panel")).toBe(true);
    // A chart viz primitive is placeable on both screens and reports.
    expect(primitivesFor("report").some((p) => p.family === "viz")).toBe(true);
  });

  it("getPrimitive resolves by family + id; store is a defensive copy", () => {
    expect(getPrimitive("field", "email")?.label).toBe("Email");
    expect(getPrimitive("panel", "form")).toBeTruthy();
    expect(getPrimitive("viz", "nope")).toBeUndefined();
    expect(primitiveStore()).not.toBe(PRIMITIVES);
    expect(primitiveStore().length).toBe(PRIMITIVES.length);
  });
});
