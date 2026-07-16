import { describe, it, expect } from "vitest";
import { PRIMITIVES, primitiveStore, primitivesByFamily, primitivesFor, getPrimitive, primitiveTree, categoriesFor, allTags, primitivesByTag } from "./primitive-store";
import { PANEL_RENDERERS } from "../components/screen/registry";
import { PRIMITIVE_LIBRARY } from "../definitions/primitives";
import { FORM_FIELD_TYPES, DOC_BLOCK_TYPES, CANVAS_ELEMENT_TYPES, ANNOTATION_TYPES, KEY_RESULT_KINDS, componentLibrary } from "@workspace/backend-catalogue";

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

  it("the block family exactly matches the shared document block types", () => {
    const store = primitivesByFamily("block").map((p) => p.id).sort();
    expect(store).toEqual([...DOC_BLOCK_TYPES].sort());
  });

  it("block primitives are placeable only on the content surface", () => {
    expect(primitivesByFamily("block").every((p) => p.placeableIn.includes("content"))).toBe(true);
    expect(primitivesFor("content").some((p) => p.family === "block")).toBe(true);
  });

  it("the canvas family exactly matches the shared canvas element types", () => {
    const store = primitivesByFamily("canvas").map((p) => p.id).sort();
    expect(store).toEqual([...CANVAS_ELEMENT_TYPES].sort());
  });

  it("canvas primitives are placeable only on the canvas surface", () => {
    expect(primitivesByFamily("canvas").every((p) => p.placeableIn.includes("canvas"))).toBe(true);
    expect(primitivesFor("canvas").some((p) => p.family === "canvas")).toBe(true);
  });

  it("the annotation family exactly matches the shared annotation types", () => {
    const store = primitivesByFamily("annotation").map((p) => p.id).sort();
    expect(store).toEqual([...ANNOTATION_TYPES].sort());
  });

  it("annotation primitives are placeable only on the proof surface", () => {
    expect(primitivesByFamily("annotation").every((p) => p.placeableIn.includes("proof"))).toBe(true);
    expect(primitivesFor("proof").some((p) => p.family === "annotation")).toBe(true);
  });

  it("the keyResult family exactly matches the shared key-result kinds", () => {
    const store = primitivesByFamily("keyResult").map((p) => p.id).sort();
    expect(store).toEqual([...KEY_RESULT_KINDS].sort());
  });

  it("keyResult primitives are placeable only on the goal surface", () => {
    expect(primitivesByFamily("keyResult").every((p) => p.placeableIn.includes("goal"))).toBe(true);
    expect(primitivesFor("goal").some((p) => p.family === "keyResult")).toBe(true);
  });

  it("the component family exactly matches the shared component library", () => {
    const store = primitivesByFamily("component").map((p) => p.id).sort();
    const lib = componentLibrary().map((c) => c.id).sort();
    expect(store).toEqual(lib);
  });

  it("ids are unique within each family", () => {
    for (const family of ["panel", "viz", "field", "block", "canvas", "annotation", "keyResult", "component"] as const) {
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

  it("every primitive has a non-empty category subfolder", () => {
    for (const p of PRIMITIVES) expect(p.category, `${p.family}/${p.id}`).toBeTruthy();
  });

  it("primitiveTree groups family -> category subfolders -> primitives", () => {
    const tree = primitiveTree();
    const panel = tree.find((t) => t.family === "panel")!;
    expect(panel.folders.length).toBeGreaterThan(1); // panels span multiple subfolders (data/input/visualisation/…)
    // Every primitive in the tree lands under its own category, and folders are non-empty.
    for (const fam of tree) for (const folder of fam.folders) {
      expect(folder.primitives.length).toBeGreaterThan(0);
      expect(folder.primitives.every((p) => p.category === folder.category)).toBe(true);
    }
    // A surface-scoped tree only contains placeable primitives.
    const formTree = primitiveTree("form");
    expect(formTree.every((t) => t.family === "field")).toBe(true);
  });

  it("categoriesFor lists a family's subfolders", () => {
    expect(categoriesFor("field").sort()).toEqual(["boolean", "choice", "composite", "numeric", "scale", "temporal", "text"]);
    expect(categoriesFor("panel")).toContain("input");
  });

  it("tags are cross-cutting and filterable across families", () => {
    expect(allTags()).toContain("editable");
    // "editable" spans a panel (register/form) — cross-cutting, independent of the folder path.
    const editable = primitivesByTag("editable");
    expect(editable.some((p) => p.id === "register")).toBe(true);
    expect(editable.some((p) => p.id === "form")).toBe(true);
    expect(primitivesByTag("timeseries").some((p) => p.family === "viz")).toBe(true);
    expect(primitivesByTag("nonexistent-tag")).toEqual([]);
  });
});
