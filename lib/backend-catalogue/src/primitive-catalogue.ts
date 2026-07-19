import type { PrimitiveCategory, PrimitiveParamShape, PrimitiveDefShape } from "./primitive-schema";
// DERIVED primitives — everything that COMPOSES from a root (`extends`) is DATA, authored as JSON recipes under
// primitives/ (like screens/reports/mappings). Only the ROOT primitives below stay in TypeScript. A derived
// primitive is a thin recipe: an id + label + category + `extends` + the params it adds/re-declares.
import geometryCanvas from "./primitives/geometry-canvas.json";
import screenPrim from "./primitives/screen.json";
import formPrim from "./primitives/form.json";
import reportPrim from "./primitives/report.json";
import chartPrim from "./primitives/chart.json";
import interactiveChart from "./primitives/interactive-chart.json";
import barPrim from "./primitives/bar.json";
import lineChart from "./primitives/line-chart.json";
import areaPrim from "./primitives/area.json";
import piePrim from "./primitives/pie.json";
import donutPrim from "./primitives/donut.json";
import scatterPrim from "./primitives/scatter.json";
import treemapPrim from "./primitives/treemap.json";
import ganttPrim from "./primitives/gantt.json";
import recordSet from "./primitives/record-set.json";
import tablePrim from "./primitives/table.json";
import registerPrim from "./primitives/register.json";
import dataSlot from "./primitives/data-slot.json";
import statTile from "./primitives/stat-tile.json";
import badgePrim from "./primitives/badge.json";

/**
 * THE SHIPPED PRIMITIVE CATALOGUE — the library of every rendering primitive the product ships, so the
 * view/report/chart builders (and the def store) can discover what artifacts compose from. ONE source of truth
 * feeds both the BACKEND seeder (system `primitive` defs) and the SPA palette — the React RENDERERS stay engine,
 * only these definitions are data.
 *
 * ROOTS vs DERIVED: the ROOT primitives (built on nothing — no `extends`) live in TypeScript below, because a
 * root is code-level foundation. Everything that COMPOSES from a root (`extends`) is DATA and is authored as a
 * JSON recipe under primitives/ (the same rule screens/reports/mappings follow) — see the imports above. The
 * catalogue is roots ⧺ derived. The shared shapes come from `primitive-schema` (the ONE primitive contract, also
 * used by `validatePrimitiveDef`); `PrimitiveDef` / `PrimitiveParam` are the render-facing aliases.
 */
export type PrimitiveDef = PrimitiveDefShape;
export type PrimitiveParam = PrimitiveParamShape;

const HEIGHT_PARAM: PrimitiveParam = { key: "height", label: "Height", type: "number", required: false, description: "Pixel height, or a percent string for responsive containers." };

const ROOT_PRIMITIVES: PrimitiveDef[] = [
  // ── GEOMETRY — the fundamental atoms of the drawable plane ──────────────────────────────────────
  // The true building blocks: a line, a rectangle, a text run, a point. Every chart/diagram/gantt and
  // every visual grid composes UP from these; each instance's geometry (coordinates/size) and style
  // (colour, thickness) is supplied from system JSON. These are roots (no `extends`) — the smallest
  // set everything drawable is built on. The semantic plane (tables/tiles) is NOT drawn from these.
  {
    id: "line",
    label: "Line",
    category: "geometry",
    description: "A straight line segment between two points — the atom behind axes, gridlines, connectors and any drawn rule. Length is the distance between its endpoints.",
    params: [
      { key: "x1", label: "Start X", type: "number", required: true, description: "First endpoint, x (canvas units)." },
      { key: "y1", label: "Start Y", type: "number", required: true, description: "First endpoint, y (canvas units)." },
      { key: "x2", label: "End X", type: "number", required: true, description: "Second endpoint, x (canvas units)." },
      { key: "y2", label: "End Y", type: "number", required: true, description: "Second endpoint, y (canvas units)." },
      { key: "stroke", label: "Stroke", type: "string", required: false, description: "Line colour as a hex string (defaults to the current foreground)." },
      { key: "thickness", label: "Thickness", type: "number", required: false, description: "Stroke width in canvas units (default 1)." },
      { key: "dash", label: "Dash", type: "string", required: false, description: "SVG dash pattern, e.g. \"4 4\" for a dashed line (solid when unset)." },
    ],
  },
  {
    id: "rect",
    label: "Rectangle",
    category: "geometry",
    description: "An axis-aligned rectangle — the atom behind bars, gantt spans, allocation blocks, tiles' frames and grid cells.",
    params: [
      { key: "x", label: "X", type: "number", required: true, description: "Top-left corner, x (canvas units)." },
      { key: "y", label: "Y", type: "number", required: true, description: "Top-left corner, y (canvas units)." },
      { key: "width", label: "Width", type: "number", required: true, description: "Rectangle width (canvas units)." },
      { key: "height", label: "Height", type: "number", required: true, description: "Rectangle height (canvas units)." },
      { key: "fill", label: "Fill", type: "string", required: false, description: "Fill colour as a hex string (none when unset)." },
      { key: "stroke", label: "Stroke", type: "string", required: false, description: "Border colour as a hex string." },
      { key: "thickness", label: "Thickness", type: "number", required: false, description: "Border stroke width (default 1)." },
      { key: "radius", label: "Corner radius", type: "number", required: false, description: "Rounded-corner radius (0 = square)." },
    ],
  },
  {
    id: "text",
    label: "Text",
    category: "geometry",
    description: "A single run of text positioned on the canvas — the atom behind axis labels, data labels and legends on the drawable plane.",
    params: [
      { key: "x", label: "X", type: "number", required: true, description: "Anchor point, x (canvas units)." },
      { key: "y", label: "Y", type: "number", required: true, description: "Anchor point, y (canvas units)." },
      { key: "content", label: "Content", type: "string", required: true, description: "The text to draw." },
      { key: "size", label: "Font size", type: "number", required: false, description: "Font size in canvas units (default 12)." },
      { key: "fill", label: "Fill", type: "string", required: false, description: "Text colour as a hex string." },
      { key: "weight", label: "Weight", type: "enum", required: false, description: "Font weight.", options: ["normal", "bold"] },
      { key: "anchor", label: "Anchor", type: "enum", required: false, description: "Horizontal anchoring of the text to (x, y).", options: ["start", "middle", "end"] },
    ],
  },
  {
    id: "point",
    label: "Point",
    category: "geometry",
    description: "A single marked point (a small filled circle) — the atom behind scatter marks, network nodes and line-chart vertices.",
    params: [
      { key: "x", label: "X", type: "number", required: true, description: "Centre, x (canvas units)." },
      { key: "y", label: "Y", type: "number", required: true, description: "Centre, y (canvas units)." },
      { key: "r", label: "Radius", type: "number", required: false, description: "Marker radius in canvas units (default 2)." },
      { key: "fill", label: "Fill", type: "string", required: false, description: "Marker colour as a hex string." },
    ],
  },
  {
    id: "path",
    label: "Path",
    category: "geometry",
    description: "An arbitrary SVG path — the atom behind CURVES and FILLED regions the straight-edged atoms can't express: pie/donut arcs, area-chart fills, smooth trend lines.",
    params: [
      { key: "d", label: "Path data", type: "string", required: true, description: "SVG path commands (the `d` attribute), e.g. \"M0 0 L10 10 …\"." },
      { key: "fill", label: "Fill", type: "string", required: false, description: "Fill colour as a hex string (none when unset — a stroked outline)." },
      { key: "stroke", label: "Stroke", type: "string", required: false, description: "Outline colour as a hex string." },
      { key: "thickness", label: "Thickness", type: "number", required: false, description: "Outline stroke width (default 1)." },
    ],
  },
  // ── THE VISUALS TREE — canvas is the root of everything the user SEES ────────────────────────────
  // `canvas` is an abstract surface (content + layout). Everything visual is a canvas made specific: the
  // DRAWABLE branch (geometry-canvas ← chart ← interactive-chart ← bar/line/…), and the DOM surfaces
  // (screen / form / report / table). Each level DOWN is a thinner def and more specific; the resolved
  // def gets richer as it inherits. The atomic building blocks placed INTO these visuals — geometry
  // marks, tiles, and controls (switch/label) — are their own primitives, not ancestors of canvas.
  {
    id: "canvas",
    label: "Canvas",
    category: "surface",
    description: "The abstract visual surface — a bounded space with content and layout that EVERY visual specializes. A screen, a chart, a form and a report are all a canvas made specific. The root of the visuals tree.",
    params: [
      { key: "width", label: "Width", type: "number", required: false, description: "Surface width (user units for a drawing; grid columns for a layout). Scales to its container." },
      { key: "height", label: "Height", type: "number", required: false, description: "Surface height (user units), where meaningful." },
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
  // ── DATA-STRUCTURES TREE — the SHAPE of data, independent of how it's shown ─────────────────────
  // `record-set` is the root: a set of typed records (columns/fields + rows). Its editable
  // specialisations (register → data-slot) are DATA, not visuals — they're bound to a store and own
  // CRUD. A VISUAL that shows a record set (the `table` below) BINDS to one; it does not extend it.
  // ── DATA-STRUCTURES TREE — root is `record`; all records belong to a set ─────────────────────────
  // A `record` is the atomic data structure (its typed fields). But a record never lives alone — it
  // belongs to a `record-set`, which extends `record` by adding the collection (rows) over that
  // schema. The editable sets (register → data-slot) specialise the set. A VISUAL (table) binds to a
  // record-set to show it. Lineage: data-slot → register → record-set → record.
  {
    id: "record",
    label: "Record",
    category: "data-structure",
    description: "The atomic data structure — a single record's typed fields (its schema). Pure DATA. A record never stands alone: it belongs to a `record-set`.",
    params: [
      { key: "columns", label: "Fields", type: "columns", required: true, description: "The record's typed fields: key, label, type/alignment. Its schema." },
    ],
  },
  // ── CONTROL ATOMS — the building blocks of settings & forms ──────────────────────────────────────
  // A setting is atomic: a SWITCH (the input) with a LABEL (the caption). Forms and the settings tree
  // compose from these — expressed as primitives, not bespoke UI. They are placed INTO visuals
  // (screens/forms), not ancestors of canvas.
  {
    id: "label",
    label: "Label",
    category: "control",
    description: "A caption for a control or value — the atom that names a setting/field. Pure text, optionally bound to the control it labels.",
    params: [
      { key: "text", label: "Text", type: "string", required: true, description: "The caption text." },
      { key: "for", label: "For", type: "string", required: false, description: "Id of the control this labels (accessible association)." },
    ],
  },
  {
    id: "switch",
    label: "Switch",
    category: "control",
    description: "A control that selects a state — the input atom every setting is built from (a switch + a label). A boolean toggle by default; supply `positions` for a multi-position switch.",
    params: [
      { key: "value", label: "Value", type: "string", required: true, description: "The current position (\"on\"/\"off\" for a toggle, or one of `positions`)." },
      { key: "positions", label: "Positions", type: "items", required: false, description: "The allowed positions for a multi-position switch; omit for a boolean on/off toggle." },
    ],
  },
  {
    id: "field",
    label: "Field",
    category: "control",
    description: "A labelled input placed on ANY visual (form/screen/report) — a reusable atom like a tile. Binds to a `decision` (its `source`): the decision's TYPE tells the field which control to render (toggle / select / number / text) and with what options.",
    params: [
      { key: "label", label: "Label", type: "string", required: true, description: "The field's caption." },
      { key: "source", label: "Decision", type: "string", required: false, description: "Id of the decision this field renders; its type drives the control shown. Omit to configure inline." },
      { key: "value", label: "Value", type: "string", required: false, description: "The current value (the chosen position/option/number/text)." },
    ],
  },
  // ── SETTINGS TREE — the DECISION (data), which drives the visual control ─────────────────────────
  // A setting is a DECISION with a TYPE (boolean / single-choice / … ) and its options. This is DATA,
  // like a record-set; a `field` (visual) binds to it and the decision's type tells the field what to
  // render and with what options — the same data→visual seam as record-set → table.
  {
    id: "decision",
    label: "Decision",
    category: "setting",
    description: "A setting to be decided — its TYPE (boolean, single-choice, multi-choice, number, text) plus options and current value. Pure DATA (the settings tree); a `field` visual binds to it and renders the control its type calls for. Every non-`label` decision carries a validation + sanitise policy (defaulted securely by type), so the field it drives always cleans and checks input.",
    params: [
      { key: "type", label: "Decision type", type: "enum", required: true, description: "What kind of decision this is — drives which control the visual renders. `label` is display-only (no input).", options: ["boolean", "single-choice", "multi-choice", "number", "text", "label"] },
      { key: "options", label: "Options", type: "items", required: false, description: "The allowed choices (for single-choice / multi-choice); ignored for boolean/number/text." },
      { key: "value", label: "Value", type: "string", required: false, description: "The current/default decision value." },
      { key: "validation", label: "Validation", type: "string", required: false, description: "Validation floor for a non-label field (required/min/max/pattern/options). Tightens the secure default the type provides; every non-label field is validated either way." },
      { key: "sanitise", label: "Sanitise", type: "items", required: false, description: "Extra sanitise steps ADDED to the secure default (trim/escape/…). A non-label field is always sanitised before its value is stored; these can only tighten, never remove, the floor." },
    ],
  },
  // ── TILE — a cross-cutting atom (goes on a screen, a report, a chart) ────────────────────────────
  // A tile has a size, a colour, a shape and a content field; it's STATIC by default and INTERACTIVE
  // when `clickable` (the additive interactivity level, as for charts). The specific tiles (stat-tile,
  // badge) are thinner children that add their own content shape.
  {
    id: "tile",
    label: "Tile",
    category: "tile",
    description: "A bounded content block placed on ANY visual (screen/report/chart) — has a size, colour, shape and a content field. Static by default; set `clickable` to make it interactive (the additive interactivity level). The base every specific tile specializes.",
    params: [
      { key: "content", label: "Content", type: "string", required: false, description: "The tile's content (text, or a reference resolved by the renderer)." },
      { key: "size", label: "Size", type: "enum", required: false, description: "Tile size.", options: ["small", "medium", "large"] },
      { key: "color", label: "Colour", type: "string", required: false, description: "Fill/accent colour as a hex string or theme token." },
      { key: "shape", label: "Shape", type: "enum", required: false, description: "Tile shape.", options: ["square", "rounded", "pill", "circle"] },
      { key: "clickable", label: "Clickable", type: "boolean", required: false, description: "Make the tile interactive — clickable, with an optional `action`." },
      { key: "action", label: "Action", type: "string", required: false, description: "What a click does (route / command); only meaningful when clickable." },
    ],
  },
];

/** The DERIVED primitives — authored as JSON recipes (each `extends` a root/ancestor), in catalogue order. */
const DERIVED_PRIMITIVES = [
  geometryCanvas, screenPrim, formPrim, reportPrim, chartPrim, interactiveChart,
  barPrim, lineChart, areaPrim, piePrim, donutPrim, scatterPrim, treemapPrim, ganttPrim,
  recordSet, tablePrim, registerPrim, dataSlot, statTile, badgePrim,
] as unknown as PrimitiveDef[];

/** The whole shipped catalogue: the TypeScript ROOTS ⧺ the JSON-authored DERIVED recipes. */
export const PRIMITIVE_CATALOGUE: PrimitiveDef[] = [...ROOT_PRIMITIVES, ...DERIVED_PRIMITIVES];

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

/** A primitive with its `extends` chain executed: params flattened property-by-property (child wins) plus the
 *  provenance to trace back what it is built from. */
export interface ResolvedPrimitive extends PrimitiveDef {
  /** The composition chain, leaf → root, e.g. `["data-slot", "register", "table"]`. */
  lineage: string[];
  /** Per effective param key → the def in the lineage that supplied the WINNING value. */
  provenance: Record<string, string>;
}

/**
 * Execute a primitive's composition: walk `extends` to a root, then merge each ancestor's params by KEY from
 * root → leaf so a thin child ADDS new params and ALTERS ones it re-declares (child wins), while inheriting the
 * rest. Returns the flattened def PLUS its `lineage` and per-param `provenance`, so from any leaf you can trace
 * every def + field it is built from. Throws on a missing parent or an `extends` cycle (fail-closed — a broken
 * chain is a data error, not a silently-partial primitive). Undefined when `id` is unknown.
 */
export function resolvePrimitive(id: string, catalogue: PrimitiveDef[] = PRIMITIVE_CATALOGUE): ResolvedPrimitive | undefined {
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const chain: PrimitiveDef[] = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  if (!cur) return undefined;
  while (cur) {
    if (seen.has(cur.id)) throw new Error(`primitive "${id}": extends cycle at "${cur.id}"`);
    seen.add(cur.id);
    chain.push(cur);
    if (!cur.extends) break;
    const parent = byId.get(cur.extends);
    if (!parent) throw new Error(`primitive "${cur.id}": extends "${cur.extends}" which is not in the catalogue`);
    cur = parent;
  }
  // Merge root → leaf so the leaf's re-declared params win but keep their first-seen position.
  const merged = new Map<string, { param: PrimitiveParam; from: string }>();
  for (let i = chain.length - 1; i >= 0; i--) {
    const d = chain[i]!;
    for (const p of d.params) merged.set(p.key, { param: p, from: d.id });
  }
  const params: PrimitiveParam[] = [];
  const provenance: Record<string, string> = {};
  for (const { param, from } of merged.values()) { params.push(param); provenance[param.key] = from; }
  const leaf = chain[0]!;
  return {
    id: leaf.id,
    label: leaf.label,
    category: leaf.category,
    description: leaf.description,
    ...(leaf.chartType ? { chartType: leaf.chartType } : {}),
    ...(leaf.extends ? { extends: leaf.extends } : {}),
    params,
    lineage: chain.map((d) => d.id),
    provenance,
  };
}

/** The root primitives — those built on nothing (no `extends`). We keep these few and generic; everything else
 *  composes from them. */
export function rootPrimitives(): PrimitiveDef[] {
  return PRIMITIVE_CATALOGUE.filter((p) => !p.extends).map((p) => ({ ...p }));
}
