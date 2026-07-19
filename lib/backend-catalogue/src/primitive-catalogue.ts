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
    id: "geometry-canvas",
    label: "Geometry canvas",
    category: "geometry",
    extends: "canvas",
    description: "A canvas that draws GEOMETRY ATOMS (line/rect/text/point/path). Inherits the surface; adds the shapes it renders. The drawable branch of the visuals tree.",
    params: [
      { key: "shapes", label: "Shapes", type: "rows", required: false, description: "The geometry-atom instances to draw (each an atom `type` + its params)." },
    ],
  },
  {
    id: "screen",
    label: "Screen",
    category: "surface",
    extends: "canvas",
    description: "A canvas laid out as a grid of PANELS — the DOM visual behind every screen. Inherits the surface; adds the panels and their layout. Rendered as accessible DOM, composed from tiles/controls/tables/charts.",
    params: [
      { key: "panels", label: "Panels", type: "rows", required: true, description: "The panels on the screen (each a `kind` + its config), placed on the layout grid." },
    ],
  },
  {
    id: "form",
    label: "Form",
    category: "surface",
    extends: "canvas",
    description: "A canvas of input FIELDS — the DOM visual behind every form/intake. Inherits the surface; adds the fields, which are composed from `control` atoms (switch, label, …). A submission creates a work item via the broker.",
    params: [
      { key: "fields", label: "Fields", type: "rows", required: true, description: "The form's fields, each a control (switch/label/input) + its binding." },
    ],
  },
  {
    id: "report",
    label: "Report",
    category: "surface",
    extends: "canvas",
    description: "A canvas composed of ordered SECTIONS (metrics, tables, charts, prose) — the DOM visual behind every report. Inherits the surface; adds the sections.",
    params: [
      { key: "sections", label: "Sections", type: "rows", required: true, description: "The report's ordered sections (each a kind + its content)." },
    ],
  },
  {
    id: "chart",
    label: "Chart",
    category: "chart",
    extends: "geometry-canvas",
    description: "A geometry-canvas that plots DATA as atoms — the abstract base every concrete chart inherits. Adds presentation (palette, legend); the data shape is added by each concrete chart.",
    params: [
      LEGEND_PARAM,
      PALETTE_PARAM,
    ],
  },
  {
    id: "interactive-chart",
    label: "Interactive chart",
    category: "chart",
    extends: "chart",
    description: "A chart WITH interaction — inherits every chart property and adds the interaction layer (hover/focus tooltips). Interactivity is a level in the taxonomy, so an interactive chart is a chart plus this.",
    params: [
      { key: "interactive", label: "Interactive", type: "boolean", required: false, description: "Enable the hover/focus tooltip layer over the chart's marks." },
      { key: "tooltip", label: "Tooltip", type: "string", required: false, description: "Tooltip content template for a mark (defaults to its label + value)." },
    ],
  },
  {
    id: "bar",
    label: "Bar chart",
    category: "chart",
    extends: "chart",
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
    id: "line-chart",
    label: "Line chart",
    category: "chart",
    extends: "chart",
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
    extends: "chart",
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
    extends: "chart",
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
    extends: "chart",
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
    extends: "chart",
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
    extends: "chart",
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
    extends: "chart",
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
  // ── DATA-STRUCTURES TREE — the SHAPE of data, independent of how it's shown ─────────────────────
  // `record-set` is the root: a set of typed records (columns/fields + rows). Its editable
  // specialisations (register → data-slot) are DATA, not visuals — they're bound to a store and own
  // CRUD. A VISUAL that shows a record set (the `table` below) BINDS to one; it does not extend it.
  {
    id: "record-set",
    label: "Record set",
    category: "data-structure",
    description: "A structured set of records — typed columns/fields plus rows. A pure DATA STRUCTURE, independent of how it's displayed; a visual (table/board/chart) binds to it to show it.",
    params: [
      { key: "columns", label: "Columns", type: "columns", required: true, description: "The fields/columns: key, label, type/alignment. The record set's schema." },
      { key: "rows", label: "Rows", type: "rows", required: true, description: "One object per record." },
    ],
  },
  {
    id: "table",
    label: "Data table",
    category: "table",
    extends: "canvas",
    description: "The VISUAL that renders a record set as generic sortable columns and rows (accessible DOM) with per-column rendering and an optional footer — a canvas made specific. Binds to a record set via `source`, or takes inline columns/rows.",
    params: [
      { key: "source", label: "Record set", type: "string", required: false, description: "Id of the record set to render (binds the visual to a data structure); omit to supply columns/rows inline." },
      { key: "columns", label: "Columns", type: "columns", required: true, description: "Display columns: key, label, alignment, and render." },
      { key: "rows", label: "Rows", type: "rows", required: true, description: "One object per row (inline, when not bound to a source)." },
    ],
  },
  {
    id: "register",
    label: "Editable register",
    category: "data-structure",
    // COMPOSITION: an editable `record-set` — a DATA STRUCTURE with CRUD, not a visual. Thin child —
    // inherits `columns`, ALTERS `rows` (now sourced, not authored), and ADDS the editable-source
    // params. Its new functionality vs a plain record set is the add/edit/delete + Save round-trip.
    extends: "record-set",
    description: "A record set you can complete and update in place — add / edit / delete rows and Save. Rows come from a settings collection or a generic mapping slot; the server owns the write.",
    params: [
      { key: "rows", label: "Rows", type: "rows", required: false, description: "Rows come from the bound source (a settings collection or a mapping slot), not authored inline." },
      { key: "collection", label: "Settings collection", type: "string", required: false, description: "Settings field key to read/write (settings-collection source)." },
      { key: "endpoint", label: "Endpoint", type: "string", required: false, description: "PUT target for the settings-collection source." },
      { key: "slot", label: "Slot", type: "string", required: false, description: "Mapping slot to read/write via the generic surface (slot source); mutually exclusive with collection." },
      { key: "addLabel", label: "Add-button label", type: "string", required: false, description: "Caption on the add-row button." },
      { key: "defaultEditRole", label: "Edit role", type: "enum", required: false, description: "Minimum role allowed to edit; anyone below sees it read-only.", options: ["contributor", "manager", "pmo", "admin", "readonly"] },
    ],
  },
  {
    id: "data-slot",
    label: "Data-slot register",
    category: "data-structure",
    // COMPOSITION: a `register` specialised to the generic mapping-slot source. The thinnest possible child —
    // it ONLY alters `slot` to required. Its genuinely-new functionality: a register over ANY mapping slot
    // (epics, sprints, raid, milestones, …) as a pure screen def, no bespoke endpoint. Renders via `register`.
    extends: "register",
    description: "An editable register bound to a generic mapping slot — rows read/written through the same generic mapping surface every slot uses, so a register/board over any slot is a pure JSON screen def.",
    params: [
      { key: "slot", label: "Slot", type: "string", required: true, description: "The mapping slot this register is bound to (its one added constraint over a plain register)." },
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
    description: "A setting to be decided — its TYPE (boolean, single-choice, multi-choice, number, text) plus options and current value. Pure DATA (the settings tree); a `field` visual binds to it and renders the control its type calls for.",
    params: [
      { key: "type", label: "Decision type", type: "enum", required: true, description: "What kind of decision this is — drives which control the visual renders.", options: ["boolean", "single-choice", "multi-choice", "number", "text"] },
      { key: "options", label: "Options", type: "items", required: false, description: "The allowed choices (for single-choice / multi-choice); ignored for boolean/number/text." },
      { key: "value", label: "Value", type: "string", required: false, description: "The current/default decision value." },
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
