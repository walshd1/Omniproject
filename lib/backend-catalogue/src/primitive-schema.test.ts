import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRIMITIVE_PARAM_TYPES, PRIMITIVE_CATEGORIES, CHART_VIEW_TYPES, validatePrimitiveDef,
} from "./primitive-schema";

/** The shared primitive-bundle schema + validator — the deterministic "test" an authoring tool runs. */

const GOOD = {
  id: "grouped-column",
  label: "Grouped columns",
  category: "chart",
  description: "Compare several series across categories.",
  chartType: "bar",
  params: [
    { key: "data", label: "Rows", type: "rows", required: true, description: "One object per category." },
    { key: "series", label: "Series", type: "series", required: true, description: "Which keys to plot." },
    { key: "orientation", label: "Orientation", type: "enum", required: false, description: "Bar direction.", options: ["horizontal", "vertical"] },
  ],
};

test("closed sets are the expected values", () => {
  assert.deepEqual([...PRIMITIVE_CATEGORIES], ["surface", "geometry", "chart", "graphic", "control", "setting", "data-structure", "table", "tile"]);
  assert.deepEqual([...CHART_VIEW_TYPES], ["bar", "line", "area", "pie", "donut", "scatter", "treemap", "gantt"]);
  assert.ok(PRIMITIVE_PARAM_TYPES.includes("rows") && PRIMITIVE_PARAM_TYPES.includes("enum"));
});

test("a well-formed primitive validates and returns a normalised def", () => {
  const r = validatePrimitiveDef(GOOD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.def?.id, "grouped-column");
  assert.equal(r.def?.chartType, "bar");
  assert.equal(r.def?.params.length, 3);
  assert.deepEqual(r.def?.params[2]?.options, ["horizontal", "vertical"]);
});

test("chartType is optional (a non-chart graphic primitive)", () => {
  const { chartType, ...noChart } = GOOD;
  void chartType;
  const r = validatePrimitiveDef({ ...noChart, category: "tile", params: [{ key: "value", label: "Value", type: "number", required: true, description: "The metric." }] });
  assert.equal(r.ok, true);
  assert.equal(r.def?.chartType, undefined);
});

test("collects every problem at once (never throws)", () => {
  const r = validatePrimitiveDef({
    id: "Bad Id",              // not kebab-case
    label: "",                 // missing
    category: "nope",          // invalid
    chartType: "sankey",       // invalid
    params: [
      { key: "a", label: "A", type: "wat", required: "yes", description: "" }, // bad type + bad required
      { key: "a", label: "Dup", type: "rows", required: true, description: "" }, // duplicate key
      { key: "c", label: "C", type: "enum", required: false, description: "" }, // enum with no options
    ],
  });
  assert.equal(r.ok, false);
  assert.ok(r.def === undefined);
  assert.ok(r.errors.length >= 6, `expected many errors, got ${r.errors.length}: ${r.errors.join(" | ")}`);
  assert.ok(r.errors.some((e) => /kebab-case/.test(e)));
  assert.ok(r.errors.some((e) => /category must be one of/.test(e)));
  assert.ok(r.errors.some((e) => /chartType must be one of/.test(e)));
  assert.ok(r.errors.some((e) => /duplicate key/.test(e)));
  assert.ok(r.errors.some((e) => /enum param needs/.test(e)));
});

test("params must be a non-empty array", () => {
  assert.equal(validatePrimitiveDef({ ...GOOD, params: [] }).ok, false);
  assert.equal(validatePrimitiveDef({ ...GOOD, params: "x" }).ok, false);
});
