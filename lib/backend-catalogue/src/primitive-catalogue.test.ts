import test from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVE_CATALOGUE, getPrimitive, primitivesByCategory, resolvePrimitive } from "./primitive-catalogue";

/**
 * The GEOMETRY atom tier — the fundamental building blocks of the drawable plane. These tests pin
 * the atoms' contract (ids, category, the geometry + style params supplied per instance from system
 * JSON) and the id split that freed `line` for the atom (the line CHART is now `line-chart`).
 */

const GEOMETRY_ATOMS = ["line", "rect", "text", "point", "path"];

test("ships the four geometry atoms, all in the geometry category", () => {
  const geom = primitivesByCategory("geometry").map((p) => p.id).sort();
  assert.deepEqual(geom, [...GEOMETRY_ATOMS].sort());
});

test("geometry atoms are roots — the smallest set everything drawable composes from", () => {
  for (const id of GEOMETRY_ATOMS) {
    const p = getPrimitive(id);
    assert.ok(p, `${id} present`);
    assert.equal(p!.extends, undefined, `${id} is a root (no extends)`);
    // A root resolves to a lineage of just itself.
    assert.deepEqual(resolvePrimitive(id)!.lineage, [id]);
  }
});

test("the line atom carries its two endpoints plus per-instance style (thickness, stroke)", () => {
  const line = getPrimitive("line")!;
  const keys = line.params.map((p) => p.key);
  for (const k of ["x1", "y1", "x2", "y2"]) assert.ok(keys.includes(k), `line has ${k}`);
  // Endpoints are required (a line needs both ends); style is optional (defaults applied at render).
  for (const k of ["x1", "y1", "x2", "y2"]) assert.equal(line.params.find((p) => p.key === k)!.required, true);
  for (const k of ["stroke", "thickness"]) assert.equal(line.params.find((p) => p.key === k)!.required, false);
});

test("the rect atom carries origin + size, the atom behind bars / gantt spans / grid cells", () => {
  const rect = getPrimitive("rect")!;
  const required = rect.params.filter((p) => p.required).map((p) => p.key).sort();
  assert.deepEqual(required, ["height", "width", "x", "y"]);
});

test("`line` is now the geometry atom; the line CHART was renamed to `line-chart`", () => {
  assert.equal(getPrimitive("line")!.category, "geometry");
  assert.equal(getPrimitive("line")!.chartType, undefined);
  const chart = getPrimitive("line-chart");
  assert.ok(chart, "line-chart present");
  assert.equal(chart!.category, "chart");
  assert.equal(chart!.chartType, "line");
});

test("no primitive id collides (geometry atoms did not duplicate an existing id)", () => {
  const ids = PRIMITIVE_CATALOGUE.map((p) => p.id);
  assert.equal(ids.length, new Set(ids).size, "all primitive ids are unique");
});
