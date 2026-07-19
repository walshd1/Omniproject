import test from "node:test";
import assert from "node:assert/strict";
import { PRIMITIVE_CATALOGUE, getPrimitive, primitivesByCategory, resolvePrimitive } from "./primitive-catalogue";

/**
 * The GEOMETRY atom tier — the fundamental building blocks of the drawable plane. These tests pin
 * the atoms' contract (ids, category, the geometry + style params supplied per instance from system
 * JSON) and the id split that freed `line` for the atom (the line CHART is now `line-chart`).
 */

const GEOMETRY_ATOMS = ["line", "rect", "text", "point", "path"];

test("geometry atoms + geometry-canvas are the geometry category; the visual surfaces are `surface`", () => {
  const geom = new Set(primitivesByCategory("geometry").map((p) => p.id));
  for (const a of GEOMETRY_ATOMS) assert.ok(geom.has(a), `${a} is a geometry atom`);
  assert.ok(geom.has("geometry-canvas"), "geometry-canvas is the drawable surface");
  const surfaces = new Set(primitivesByCategory("surface").map((p) => p.id));
  for (const s of ["canvas", "screen", "form", "report"]) assert.ok(surfaces.has(s), `${s} is a visual surface`);
});

test("the VISUALS tree is rooted at canvas: screen/form/report/table + the drawable branch all descend from it", () => {
  assert.equal(getPrimitive("canvas")!.extends, undefined); // the visuals root
  for (const id of ["screen", "form", "report", "table"]) {
    assert.deepEqual(resolvePrimitive(id)!.lineage, [id, "canvas"], `${id} is a canvas made specific`);
  }
  // The drawable branch also bottoms out at canvas.
  assert.equal(resolvePrimitive("bar")!.lineage.at(-1), "canvas");
  // Control atoms + the base tile are their OWN roots (materials placed into ANY visual — a tile/field
  // goes on a report, a chart or a screen alike). Specific tiles specialize the base tile.
  for (const id of ["switch", "label", "field", "tile"]) {
    assert.equal(getPrimitive(id)!.extends, undefined, `${id} is an atomic primitive (a root)`);
  }
  assert.deepEqual(resolvePrimitive("stat-tile")!.lineage, ["stat-tile", "tile"]);
  assert.deepEqual(resolvePrimitive("badge")!.lineage, ["badge", "tile"]);
});

test("the base tile carries size / colour / shape / content and the additive `clickable` interactivity", () => {
  const tile = getPrimitive("tile")!;
  const keys = new Set(tile.params.map((p) => p.key));
  for (const k of ["content", "size", "color", "shape", "clickable"]) assert.ok(keys.has(k), `tile has ${k}`);
  // Static by default: clickable is optional (interactivity is additive).
  assert.equal(tile.params.find((p) => p.key === "clickable")!.required, false);
  // A specific tile inherits all of that and adds its own content shape.
  const stat = resolvePrimitive("stat-tile")!;
  const statKeys = new Set(stat.params.map((p) => p.key));
  assert.ok(statKeys.has("size") && statKeys.has("clickable"), "stat-tile inherits the base tile's props");
  assert.ok(statKeys.has("value"), "stat-tile adds its metric value");
});

test("the settings tree: a `decision` defines the TYPE that drives the visual `field`", () => {
  const decision = getPrimitive("decision")!;
  assert.equal(decision.category, "setting");
  // The decision TYPE is a fixed, closed set of decision kinds.
  const typeParam = decision.params.find((p) => p.key === "type")!;
  assert.equal(typeParam.required, true);
  assert.deepEqual(typeParam.options, ["boolean", "single-choice", "multi-choice", "number", "text"]);
  // The field (visual, control) binds to a decision via `source` — the data→visual seam.
  const field = getPrimitive("field")!;
  assert.equal(field.category, "control");
  assert.ok(field.params.some((p) => p.key === "source"), "a field binds to a decision it renders");
});

test("the drawable render-surface spine inherits linearly: canvas ← geometry-canvas ← chart ← interactive-chart", () => {
  assert.deepEqual(resolvePrimitive("canvas")!.lineage, ["canvas"]); // the root surface
  assert.deepEqual(resolvePrimitive("geometry-canvas")!.lineage, ["geometry-canvas", "canvas"]);
  assert.deepEqual(resolvePrimitive("chart")!.lineage, ["chart", "geometry-canvas", "canvas"]);
  assert.deepEqual(resolvePrimitive("interactive-chart")!.lineage, ["interactive-chart", "chart", "geometry-canvas", "canvas"]);
  // An interactive chart therefore INHERITS every chart + geometry-canvas + canvas param.
  const ic = resolvePrimitive("interactive-chart")!;
  const keys = new Set(ic.params.map((p) => p.key));
  assert.ok(keys.has("interactive"), "adds its own interaction param");
  assert.ok(keys.has("legend") && keys.has("palette"), "inherits chart's presentation params");
  assert.ok(keys.has("shapes"), "inherits geometry-canvas's shapes");
  assert.ok(keys.has("width") && keys.has("height"), "inherits canvas's surface dims");
});

test("every concrete chart is a child of `chart` (traces back through geometry-canvas to the canvas)", () => {
  for (const id of ["bar", "line-chart", "area", "pie", "donut", "scatter", "treemap", "gantt"]) {
    const r = resolvePrimitive(id)!;
    assert.ok(r, `${id} present`);
    assert.deepEqual(r.lineage.slice(-3), ["chart", "geometry-canvas", "canvas"], `${id} extends chart→geometry-canvas→canvas`);
    // `shapes` is declared ONLY on geometry-canvas, so its presence proves real inheritance up the spine.
    assert.ok(r.params.some((p) => p.key === "shapes"), `${id} inherits shapes from geometry-canvas`);
  }
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
