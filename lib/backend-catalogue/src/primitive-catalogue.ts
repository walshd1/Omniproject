import type { PrimitiveCategory, PrimitiveParamShape, PrimitiveDefShape } from "./primitive-schema";

/**
 * THE SHIPPED PRIMITIVE CATALOGUE — a data-only library of every rendering primitive the product ships, so the
 * view/report/chart builders (and the def store) can discover what artifacts compose from. Relocated here from
 * the SPA (roadmap X.11: "make … primitives system JSON") so ONE source of truth feeds both the BACKEND seeder
 * (system `primitive` defs) and the SPA palette — the React RENDERERS stay engine, only these definitions are
 * data. It is metadata, not components: each entry names a primitive, the shape of data it consumes, and its
 * options; nothing here imports React, so it serialises straight into a def. The shared shapes come from
 * `primitive-schema` (the ONE primitive contract, also used by `validatePrimitiveDef`); `PrimitiveDef` /
 * `PrimitiveParam` are re-exported as the render-facing aliases the SPA already imports.
 */
export type PrimitiveDef = PrimitiveDefShape;
export type PrimitiveParam = PrimitiveParamShape;

const PALETTE_PARAM: PrimitiveParam = { key: "palette", label: "Palette", type: "palette", required: false, description: "Ordered hex colours; series/slices take them in turn." };
const LEGEND_PARAM: PrimitiveParam = { key: "legend", label: "Legend", type: "boolean", required: false, description: "Show the series legend (auto for ≥2 series)." };
const HEIGHT_PARAM: PrimitiveParam = { key: "height", label: "Height", type: "number", required: false, description: "Pixel height, or a percent string for responsive containers." };

export const PRIMITIVE_CATALOGUE: PrimitiveDef[] = [
  {
    id: "bar",
    label: "Bar chart",
    category: "chart",
    chartType: "bar",
    description: "Compare a measure across categories; multiple series can be grouped or stacked, horizontal or vertical.",
    params: [
      { key: "data", label: "Rows", type: "rows", required: true, description: "One object per category; keys are the plotted fields." },
      { key: "series", label: "Series", type: "series", required: true, description: "Which row keys to plot and their labels." },
      { key: "stacked", label: "Stacked", type: "boolean", required: false, description: "Stack series into one bar instead of grouping." },
      { key: "orientation", label: "Orientation", type: "enum", required: false, description: "Bar direction.", options: ["horizontal", "vertical"] },
      LEGEND_PARAM, HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "line",
    label: "Line chart",
    category: "chart",
    chartType: "line",
    description: "Show change over an ordered axis (usually time) for one or more series.",
    params: [
      { key: "data", label: "Rows", type: "rows", required: true, description: "One object per x position." },
      { key: "series", label: "Series", type: "series", required: true, description: "Which row keys to plot." },
      { key: "xKey", label: "X key", type: "string", required: false, description: "Row field for the x axis (defaults to name)." },
      LEGEND_PARAM, HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "area",
    label: "Area chart",
    category: "chart",
    chartType: "area",
    description: "A line chart with the area below filled; stack series to show composition over time.",
    params: [
      { key: "data", label: "Rows", type: "rows", required: true, description: "One object per x position." },
      { key: "series", label: "Series", type: "series", required: true, description: "Which row keys to plot." },
      { key: "stacked", label: "Stacked", type: "boolean", required: false, description: "Stack series to show cumulative composition." },
      { key: "xKey", label: "X key", type: "string", required: false, description: "Row field for the x axis." },
      LEGEND_PARAM, HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "pie",
    label: "Pie chart",
    category: "chart",
    chartType: "pie",
    description: "Show each category's share of a whole. Best for a handful of slices.",
    params: [
      { key: "data", label: "Slices", type: "slices", required: true, description: "{ name, value } per slice." },
      LEGEND_PARAM, HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "donut",
    label: "Donut chart",
    category: "chart",
    chartType: "donut",
    description: "A pie with a hollow centre — the same share-of-whole read, with room for a centre total.",
    params: [
      { key: "data", label: "Slices", type: "slices", required: true, description: "{ name, value } per slice." },
      LEGEND_PARAM, HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "scatter",
    label: "Scatter plot",
    category: "chart",
    chartType: "scatter",
    description: "Plot points on two numeric axes to reveal correlation or clustering.",
    params: [
      { key: "points", label: "Points", type: "points", required: true, description: "{ x, y, label? } per point." },
      { key: "xLabel", label: "X label", type: "string", required: false, description: "Axis caption." },
      { key: "yLabel", label: "Y label", type: "string", required: false, description: "Axis caption." },
      HEIGHT_PARAM,
    ],
  },
  {
    id: "treemap",
    label: "Treemap / work breakdown",
    category: "chart",
    chartType: "treemap",
    description: "Nested rectangles sized by value — a work-breakdown structure or any part-of-whole hierarchy.",
    params: [
      { key: "data", label: "Tree", type: "tree", required: true, description: "{ name, value | children } hierarchy." },
      HEIGHT_PARAM,
    ],
  },
  {
    id: "gantt",
    label: "Gantt chart",
    category: "chart",
    chartType: "gantt",
    description: "One bar per item positioned by its start/end dates on a shared time axis, with optional progress.",
    params: [
      { key: "items", label: "Items", type: "items", required: true, description: "{ label, start, end, progress? } per bar." },
      HEIGHT_PARAM, PALETTE_PARAM,
    ],
  },
  {
    id: "sparkline",
    label: "Sparkline",
    category: "graphic",
    description: "A compact trend line for a single series; null points break the line as real gaps.",
    params: [
      { key: "points", label: "Values", type: "points", required: true, description: "(number | null)[] in order." },
      { key: "label", label: "Label", type: "string", required: true, description: "Caption shown with the latest value." },
      { key: "unit", label: "Unit", type: "string", required: false, description: "Suffix on the value read-out (e.g. %)." },
      HEIGHT_PARAM,
    ],
  },
  {
    id: "network",
    label: "Network graph",
    category: "graphic",
    description: "Pre-positioned nodes joined by edges — dependency and relationship diagrams.",
    params: [
      { key: "nodes", label: "Nodes", type: "nodes", required: true, description: "{ id, x, y, label, emphasis? } per node." },
      { key: "edges", label: "Edges", type: "nodes", required: true, description: "{ from, to, emphasis?, dashed? } per edge." },
    ],
  },
  {
    id: "path-chain",
    label: "Path chain",
    category: "graphic",
    description: "An ordered A → B → C strip of labelled nodes — critical paths and sequences.",
    params: [
      { key: "nodes", label: "Nodes", type: "nodes", required: true, description: "Ordered string labels." },
      { key: "tone", label: "Tone", type: "enum", required: false, description: "Node colour for state.", options: ["critical", "neutral"] },
    ],
  },
  {
    id: "geo",
    label: "Geo plot",
    category: "graphic",
    description: "Points on an equirectangular world grid — dependency-free, no external tiles.",
    params: [
      { key: "points", label: "Locations", type: "geo", required: true, description: "{ label, lat, lng } per point." },
    ],
  },
  {
    id: "allocation-bar",
    label: "Allocation bar",
    category: "graphic",
    description: "A bullet bar showing a value against 100% capacity, toned by utilisation.",
    params: [
      { key: "value", label: "Value", type: "number", required: true, description: "Percentage (null renders no data)." },
    ],
  },
  {
    id: "proportion-bar",
    label: "Proportion bar",
    category: "graphic",
    description: "A single segmented bar showing each part's share of a whole (e.g. RAG distribution).",
    params: [
      { key: "segments", label: "Segments", type: "slices", required: true, description: "{ value, className }[] shares." },
    ],
  },
  {
    id: "table",
    label: "Data table",
    category: "table",
    description: "Generic sortable columns and rows with per-column rendering and an optional footer.",
    params: [
      { key: "columns", label: "Columns", type: "columns", required: true, description: "Column key, label, alignment, and render." },
      { key: "rows", label: "Rows", type: "rows", required: true, description: "One object per row." },
    ],
  },
  {
    id: "stat-tile",
    label: "Stat tile",
    category: "tile",
    description: "A KPI tile — a headline value with a label, optional hint, and tone.",
    params: [
      { key: "label", label: "Label", type: "string", required: true, description: "What the number measures." },
      { key: "value", label: "Value", type: "string", required: true, description: "The headline figure." },
      { key: "hint", label: "Hint", type: "string", required: false, description: "Secondary context line." },
      { key: "tone", label: "Tone", type: "enum", required: false, description: "State colour.", options: ["neutral", "good", "warn", "bad", "info"] },
    ],
  },
  {
    id: "badge",
    label: "Badge",
    category: "tile",
    description: "A small status pill — a labelled chip toned for genuine state.",
    params: [
      { key: "children", label: "Text", type: "string", required: true, description: "The pill label." },
      { key: "tone", label: "Tone", type: "enum", required: false, description: "State colour.", options: ["neutral", "good", "warn", "bad", "info"] },
    ],
  },
];

/** Look up a primitive by id. */
export function getPrimitive(id: string): PrimitiveDef | undefined {
  return PRIMITIVE_CATALOGUE.find((p) => p.id === id);
}

/** Primitives in one category, e.g. all chart types the builder can offer. */
export function primitivesByCategory(category: PrimitiveCategory): PrimitiveDef[] {
  return PRIMITIVE_CATALOGUE.filter((p) => p.category === category);
}

/** Just the primitives that draw through the common ChartView renderer. */
export function chartPrimitives(): PrimitiveDef[] {
  return PRIMITIVE_CATALOGUE.filter((p) => p.chartType !== undefined);
}

/** The shipped primitive defs (a fresh array each call, so a caller can't mutate the catalogue). This is the
 *  source the backend seeds into the read-only `system` def store. */
export function primitiveCatalogue(): PrimitiveDef[] {
  return [...PRIMITIVE_CATALOGUE];
}
