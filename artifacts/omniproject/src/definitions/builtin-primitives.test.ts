import { describe, it, expect } from "vitest";
import { parseBuiltinPrimitives, mergePrimitives } from "./builtin-primitives";
import { PRIMITIVE_LIBRARY } from "./primitives";
import { PRIMITIVE_CATALOGUE, type PrimitiveDef } from "../components/charts/catalogue";

const okParam = { key: "data", label: "Rows", type: "rows", required: true, description: "d" };
const okDef = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "x", label: "X", category: "chart", description: "d", params: [okParam], ...over,
});

describe("parseBuiltinPrimitives", () => {
  it("accepts a well-formed primitive and dedupes by id", () => {
    const out = parseBuiltinPrimitives({ "a.json": okDef({ id: "a" }), "dup.json": okDef({ id: "a", label: "second" }) });
    expect(out.map((p) => p.id)).toEqual(["a"]);
    expect(out[0]!.label).toBe("X"); // first wins
  });

  it("rejects bad category, unknown chartType, and malformed params", () => {
    const out = parseBuiltinPrimitives({
      "ok.json": okDef({ id: "ok" }),
      "bad-cat.json": okDef({ id: "c", category: "nope" }),
      "bad-chart.json": okDef({ id: "d", chartType: "spiral" }),
      "bad-param.json": okDef({ id: "e", params: [{ key: "k" }] }),
      "not-object.json": 7,
    });
    expect(out.map((p) => p.id)).toEqual(["ok"]);
  });
});

describe("mergePrimitives", () => {
  const base: PrimitiveDef[] = [
    { id: "bar", label: "Bar", category: "chart", description: "d", params: [] },
    { id: "pie", label: "Pie", category: "chart", description: "d", params: [] },
  ];

  it("refreshes a baseline entry by id and appends new ones in id order", () => {
    const merged = mergePrimitives(base, [
      { id: "pie", label: "Pie (updated)", category: "chart", description: "d2", params: [] },
      { id: "zeta", label: "Zeta", category: "graphic", description: "d", params: [] },
      { id: "alpha", label: "Alpha", category: "tile", description: "d", params: [] },
    ]);
    expect(merged.find((p) => p.id === "pie")!.label).toBe("Pie (updated)"); // refreshed in place
    expect(merged.slice(0, 2).map((p) => p.id)).toEqual(["bar", "pie"]); // baseline order kept
    expect(merged.slice(2).map((p) => p.id)).toEqual(["alpha", "zeta"]); // additions sorted
  });
});

describe("PRIMITIVE_LIBRARY (resolved from the folder)", () => {
  it("contains the whole code baseline plus the shipped drop-in 'column' primitive", () => {
    for (const p of PRIMITIVE_CATALOGUE) expect(PRIMITIVE_LIBRARY.find((x) => x.id === p.id)).toBeDefined();
    const column = PRIMITIVE_LIBRARY.find((p) => p.id === "column");
    expect(column).toBeDefined();
    expect(column!.chartType).toBe("bar");
  });
});
