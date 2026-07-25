import { PANEL_RENDERERS } from "../components/screen/registry";
import { PRIMITIVE_LIBRARY } from "../definitions/primitives";
import { componentLibrary, FORM_FIELD_TYPES, DOC_BLOCK_TYPES, CANVAS_ELEMENT_TYPES, ANNOTATION_TYPES, KEY_RESULT_KINDS, INVOICE_LINE_KINDS, EXTENSION_CONTRIBUTION_KINDS, REGISTRY_ITEM_KINDS } from "@workspace/backend-catalogue";

/**
 * THE single shared primitive store — one catalogue over every renderable building block in the product,
 * across the board, so screens, reports, dashboards, content pages and forms all draw their primitives from
 * ONE source of truth instead of a registry each. It doesn't replace the family-specific renderer maps (a
 * renderer is a React component and has to live in the app); it UNIFIES their metadata under one shape and
 * one `placeableIn` vocabulary, and a drift guard (primitive-store.test) binds each family back to its
 * registry so the store can never silently diverge from what actually renders.
 *
 * Families:
 *  - `panel`     screen building blocks (metric/table/chart/register/form/…) — from the panel registry.
 *  - `viz`       data-visualisation primitives (bar/line/pie/gantt/table/tile/…) — from the chart catalogue.
 *  - `field`     form input controls (text/select/email/…) — from FORM_FIELD_TYPES.
 *  - `component` hosted reports + dashboard widgets — from the shared component library.
 *  - `block`     document/wiki content blocks (heading/paragraph/checklist/…) — from DOC_BLOCK_TYPES.
 *  - `canvas`    whiteboard elements (sticky/shape/text/connector/frame) — from CANVAS_ELEMENT_TYPES.
 *  - `annotation` proof review markers (pin/box/highlight) — from ANNOTATION_TYPES.
 *  - `keyResult` goal measures (number/percent/currency/milestone) — from KEY_RESULT_KINDS.
 *  - `invoiceLine` invoice charges (labour/expense/fixed/discount) — from INVOICE_LINE_KINDS.
 *  - `extensionContribution` marketplace extension parts (report/contentPage/dashboard/screen) — from
 *    EXTENSION_CONTRIBUTION_KINDS.
 *  - `registryItem` org-registry approved items (template/report/primitive/plugin/…) — from
 *    REGISTRY_ITEM_KINDS.
 */
export type PrimitiveFamily = "panel" | "viz" | "field" | "component" | "block" | "canvas" | "annotation" | "keyResult" | "invoiceLine" | "extensionContribution" | "registryItem";
export type PlacementSurface = "screen" | "report" | "dashboard" | "content" | "form" | "export" | "canvas" | "proof" | "goal" | "invoice" | "marketplace" | "registry";

export interface Primitive {
  /** Unique WITHIN its family (a `table` panel and a `table` viz are different primitives). */
  id: string;
  /** The bare value an author inserts to USE this primitive — the panel kind, viz id, field type, or
   *  (for the namespaced `component` family) the underlying report id / widget type. */
  sourceId: string;
  family: PrimitiveFamily;
  label: string;
  /** SUBFOLDER within the family — the palette groups primitives as `family / category`. Always set. */
  category: string;
  /** Orthogonal, cross-cutting labels for filtering the store (e.g. "timeseries", "editable",
   *  "financial") — independent of the family/category folder path. */
  tags: string[];
  /** Where an author may place this primitive. */
  placeableIn: PlacementSurface[];
}

const titleCase = (s: string): string => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** `panel` family — subfolder + tags per registered screen panel kind. */
const PANEL_META: Record<string, { category: string; tags: string[] }> = {
  metric: { category: "data", tags: ["kpi"] },
  text: { category: "content", tags: ["static"] },
  table: { category: "data", tags: ["tabular"] },
  list: { category: "data", tags: ["tabular"] },
  register: { category: "input", tags: ["editable", "tabular"] },
  form: { category: "input", tags: ["intake", "editable"] },
  chart: { category: "visualisation", tags: ["viz"] },
  graph: { category: "visualisation", tags: ["relationship", "viz"] },
  map: { category: "visualisation", tags: ["geospatial", "viz"] },
  timeline: { category: "visualisation", tags: ["schedule", "viz"] },
  board: { category: "hosted", tags: ["kanban", "interactive"] },
  view: { category: "hosted", tags: ["interactive"] },
  component: { category: "hosted", tags: ["interactive"] },
  widget: { category: "hosted", tags: ["dashboard"] },
};

/** `field` family — subfolder + tags per form input type. */
const FIELD_META: Record<string, { category: string; tags: string[] }> = {
  text: { category: "text", tags: [] },
  textarea: { category: "text", tags: ["multiline"] },
  email: { category: "text", tags: ["validated"] },
  url: { category: "text", tags: ["validated"] },
  address: { category: "composite", tags: ["multiline"] },
  number: { category: "numeric", tags: [] },
  date: { category: "temporal", tags: [] },
  select: { category: "choice", tags: ["dropdown"] },
  radio: { category: "choice", tags: [] },
  multiselect: { category: "choice", tags: ["multi"] },
  likert: { category: "scale", tags: ["survey"] },
  checkbox: { category: "boolean", tags: [] },
  yesno: { category: "boolean", tags: [] },
};

/** `block` family — subfolder + tags per document/wiki content block type. */
const BLOCK_META: Record<string, { category: string; tags: string[] }> = {
  heading: { category: "text", tags: ["structure"] },
  paragraph: { category: "text", tags: [] },
  quote: { category: "text", tags: ["emphasis"] },
  callout: { category: "text", tags: ["emphasis"] },
  code: { category: "text", tags: ["monospace"] },
  "bullet-list": { category: "list", tags: [] },
  "numbered-list": { category: "list", tags: [] },
  checklist: { category: "list", tags: ["interactive"] },
  divider: { category: "structure", tags: [] },
  table: { category: "structure", tags: ["tabular"] },
  embed: { category: "media", tags: ["reference", "external"] },
};

/** `canvas` family — subfolder + tags per whiteboard element primitive. */
const CANVAS_META: Record<string, { category: string; tags: string[] }> = {
  sticky: { category: "note", tags: ["annotate"] },
  shape: { category: "shape", tags: ["geometry"] },
  text: { category: "note", tags: [] },
  connector: { category: "relation", tags: ["link", "flow"] },
  frame: { category: "structure", tags: ["group"] },
  draw: { category: "freehand", tags: ["pen"] },
};

/** `annotation` family — subfolder + tags per proof-review marker primitive. */
const ANNOTATION_META: Record<string, { category: string; tags: string[] }> = {
  pin: { category: "marker", tags: ["point"] },
  box: { category: "region", tags: ["area"] },
  highlight: { category: "region", tags: ["area", "emphasis"] },
};

/** `keyResult` family — subfolder + tags per goal key-result measure primitive. */
const KEY_RESULT_META: Record<string, { category: string; tags: string[] }> = {
  number: { category: "quantitative", tags: ["count"] },
  percent: { category: "quantitative", tags: ["ratio"] },
  currency: { category: "quantitative", tags: ["financial"] },
  milestone: { category: "binary", tags: ["deliverable"] },
};

/** `invoiceLine` family — subfolder + tags per invoice charge primitive. */
const INVOICE_LINE_META: Record<string, { category: string; tags: string[] }> = {
  labour: { category: "charge", tags: ["billable", "hours"] },
  expense: { category: "charge", tags: ["passthrough"] },
  fixed: { category: "charge", tags: ["fee"] },
  discount: { category: "adjustment", tags: ["reduction"] },
};

/** `extensionContribution` family — subfolder + tags per marketplace extension contribution primitive. */
const EXTENSION_CONTRIBUTION_META: Record<string, { category: string; tags: string[] }> = {
  report: { category: "surface", tags: ["report"] },
  contentPage: { category: "surface", tags: ["content"] },
  dashboard: { category: "surface", tags: ["dashboard"] },
  screen: { category: "surface", tags: ["screen"] },
};

/** `registryItem` family — subfolder + tags per org-registry approved-item primitive. */
const REGISTRY_ITEM_META: Record<string, { category: string; tags: string[] }> = {
  template: { category: "reusable", tags: ["scaffold"] },
  report: { category: "reusable", tags: ["report"] },
  primitive: { category: "reusable", tags: ["building-block"] },
  plugin: { category: "reusable", tags: ["extension"] },
  screen: { category: "reusable", tags: ["screen"] },
  dashboard: { category: "reusable", tags: ["dashboard"] },
  form: { category: "reusable", tags: ["form"] },
  jsonDef: { category: "reusable", tags: ["config"] },
};

/** `viz` family — cross-cutting tags per data-visualisation primitive (subfolder is its chart category). */
const VIZ_TAGS: Record<string, string[]> = {
  bar: ["comparison"], line: ["timeseries", "trend"], area: ["timeseries", "trend"],
  pie: ["proportion"], donut: ["proportion"], scatter: ["correlation"], treemap: ["hierarchy", "proportion"],
  gantt: ["schedule", "timeline"], sparkline: ["timeseries", "compact"], network: ["relationship"],
  "path-chain": ["relationship", "flow"], geo: ["geospatial"], "allocation-bar": ["capacity"],
  "proportion-bar": ["proportion"], table: ["tabular"], "stat-tile": ["kpi"], badge: ["status"],
};

/** `panel` family — every registered screen panel kind. Panels live on screens. */
function panelPrimitives(): Primitive[] {
  return Object.keys(PANEL_RENDERERS).map((id) => {
    const meta = PANEL_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "panel", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["screen"] };
  });
}

/** `viz` family — the data-visualisation primitives (shared by chart panels AND reports). */
function vizPrimitives(): Primitive[] {
  return PRIMITIVE_LIBRARY.map((p) => ({
    id: p.id,
    sourceId: p.id,
    family: "viz",
    label: p.label ?? titleCase(p.id),
    category: p.category, // "chart" | "graphic" | "table" | "tile"
    tags: VIZ_TAGS[p.id] ?? [],
    placeableIn: ["screen", "report", "dashboard", "content"],
  }));
}

/** `field` family — the form input controls. Fields live on forms. */
function fieldPrimitives(): Primitive[] {
  return FORM_FIELD_TYPES.map((id) => {
    const meta = FIELD_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "field", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["form"] };
  });
}

/** `block` family — the document/wiki content blocks. Blocks live in documents (the `content` surface). */
function blockPrimitives(): Primitive[] {
  return DOC_BLOCK_TYPES.map((id) => {
    const meta = BLOCK_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "block", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["content"] };
  });
}

/** `canvas` family — the whiteboard element primitives. Elements live on a canvas (the `canvas` surface). */
function canvasPrimitives(): Primitive[] {
  return CANVAS_ELEMENT_TYPES.map((id) => {
    const meta = CANVAS_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "canvas", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["canvas"] };
  });
}

/** `annotation` family — the proof-review markers. Annotations live on a proof (the `proof` surface). */
function annotationPrimitives(): Primitive[] {
  return ANNOTATION_TYPES.map((id) => {
    const meta = ANNOTATION_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "annotation", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["proof"] };
  });
}

/** `keyResult` family — the goal measure primitives. Key results live on a goal (the `goal` surface). */
function keyResultPrimitives(): Primitive[] {
  return KEY_RESULT_KINDS.map((id) => {
    const meta = KEY_RESULT_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "keyResult", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["goal"] };
  });
}

/** `invoiceLine` family — the invoice charge primitives. Lines live on an invoice (the `invoice` surface). */
function invoiceLinePrimitives(): Primitive[] {
  return INVOICE_LINE_KINDS.map((id) => {
    const meta = INVOICE_LINE_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "invoiceLine", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["invoice"] };
  });
}

/** `extensionContribution` family — the marketplace extension parts. They live on the `marketplace` surface. */
function extensionContributionPrimitives(): Primitive[] {
  return EXTENSION_CONTRIBUTION_KINDS.map((id) => {
    const meta = EXTENSION_CONTRIBUTION_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "extensionContribution", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["marketplace"] };
  });
}

/** `registryItem` family — the org-registry approved-item kinds. They live on the `registry` surface. */
function registryItemPrimitives(): Primitive[] {
  return REGISTRY_ITEM_KINDS.map((id) => {
    const meta = REGISTRY_ITEM_META[id] ?? { category: "other", tags: [] };
    return { id, sourceId: id, family: "registryItem", label: titleCase(id), category: meta.category, tags: meta.tags, placeableIn: ["registry"] };
  });
}

/** `component` family — hosted reports + widgets, already placement-tagged by the shared library. */
function componentPrimitives(): Primitive[] {
  return componentLibrary().map((c) => ({
    id: c.id,
    sourceId: c.sourceId,
    family: "component",
    label: c.label,
    category: c.category, // the report kind, or "dashboard" for a widget
    tags: uniq([c.source, ...(c.requiresCapability ? [c.requiresCapability] : [])]),
    placeableIn: c.placeableIn as PlacementSurface[],
  }));
}

/** The whole store, computed once. */
export const PRIMITIVES: Primitive[] = [
  ...panelPrimitives(),
  ...vizPrimitives(),
  ...fieldPrimitives(),
  ...blockPrimitives(),
  ...canvasPrimitives(),
  ...annotationPrimitives(),
  ...keyResultPrimitives(),
  ...invoiceLinePrimitives(),
  ...extensionContributionPrimitives(),
  ...registryItemPrimitives(),
  ...componentPrimitives(),
];

/** Every primitive (a defensive copy). */
export function primitiveStore(): Primitive[] {
  return PRIMITIVES.map((p) => ({ ...p }));
}

/** Primitives of one family. */
export function primitivesByFamily(family: PrimitiveFamily): Primitive[] {
  return PRIMITIVES.filter((p) => p.family === family);
}

/** Primitives an author may place on a given surface (the palette for that surface). */
export function primitivesFor(surface: PlacementSurface): Primitive[] {
  return PRIMITIVES.filter((p) => p.placeableIn.includes(surface));
}

/** One primitive by family + id. */
export function getPrimitive(family: PrimitiveFamily, id: string): Primitive | undefined {
  return PRIMITIVES.find((p) => p.family === family && p.id === id);
}

/** A subfolder within a family. */
export interface PrimitiveFolder {
  category: string;
  primitives: Primitive[];
}
/** A family and its subfolders. */
export interface PrimitiveFamilyTree {
  family: PrimitiveFamily;
  folders: PrimitiveFolder[];
}

const FAMILY_ORDER: PrimitiveFamily[] = ["panel", "viz", "field", "block", "component"];

/** Group a flat primitive list into the family → category-subfolder tree (the shared shape the palette renders).
 *  Empty families/folders are omitted; categories are alphabetical within a family. */
function buildTree(source: Primitive[]): PrimitiveFamilyTree[] {
  const tree: PrimitiveFamilyTree[] = [];
  for (const family of FAMILY_ORDER) {
    const inFamily = source.filter((p) => p.family === family);
    if (inFamily.length === 0) continue;
    const byCat = new Map<string, Primitive[]>();
    for (const p of inFamily) (byCat.get(p.category) ?? byCat.set(p.category, []).get(p.category)!).push(p);
    const folders = [...byCat.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, primitives]) => ({ category, primitives }));
    tree.push({ family, folders });
  }
  return tree;
}

/**
 * The store as a browsable TREE — family → category subfolders → primitives. Optionally scoped to one
 * placement surface (e.g. build the "what can I drop on a screen" palette with `primitiveTree("screen")`).
 * Empty families/folders are omitted; categories are alphabetical within a family.
 */
export function primitiveTree(surface?: PlacementSurface): PrimitiveFamilyTree[] {
  return buildTree(surface ? primitivesFor(surface) : PRIMITIVES);
}

// ── Activated (customer-authored) primitives ─────────────────────────────────────────────────────────────
// The static store above is the SHIPPED vocabulary. An org may also ACTIVATE its own approved primitives
// (roadmap X — registry approval → per-scope activation), and a `blank`-derived bespoke family starts life
// there. Those live in the def store, not the static catalogue, so the builder palette folds them in at render
// time by resolving `/defs/resolved/primitive`. This is the pure merge; the hook that fetches is in the palette.

/** The minimal resolved-primitive shape the palette needs (one row of `/defs/resolved/primitive`). */
export interface ResolvedPrimitive {
  /** The def STORAGE id — e.g. `system~bar`, `org~reg-xyz`, `project~p1~reg-abc` — the scope prefix is its origin. */
  id: string;
  payload: { id: string; label?: string; category?: string; extends?: string };
}

/** The origin scope of a resolved primitive, from its storage-id prefix (system / org / programme / project / user). */
function originOf(storageId: string): string {
  const prefix = storageId.split("~")[0] ?? "system";
  return ["system", "org", "programme", "project", "user"].includes(prefix) ? prefix : "system";
}

/** Map a resolved primitive def → a palette `Primitive` in the `viz` family (where the visual primitives live).
 *  A customer-activated primitive is tagged by its origin scope + `activated`, so the palette can badge it as
 *  org/programme/project-authored; a shipped `system` one carries no origin tag (it's already in the store). */
export function primitiveFromResolved(def: ResolvedPrimitive): Primitive {
  const origin = originOf(def.id);
  return {
    id: def.payload.id,
    sourceId: def.payload.id,
    family: "viz",
    label: def.payload.label ?? titleCase(def.payload.id),
    category: def.payload.category ?? "custom",
    tags: origin === "system" ? [] : [origin, "activated"],
    placeableIn: ["screen", "report", "dashboard", "content"],
  };
}

/**
 * The palette tree INCLUDING customer-activated primitives, folded into the `viz` family. `activated` is the
 * mapped resolved set ({@link primitiveFromResolved}); each is added only when it is NOT already in the static
 * store by id (a shipped `system` primitive already appears) and is placeable on `surface` (when scoped). Pure,
 * so the palette can compute it from a fetch without another round-trip.
 */
export function primitiveTreeWith(activated: Primitive[], surface?: PlacementSurface): PrimitiveFamilyTree[] {
  const known = new Set(PRIMITIVES.filter((p) => p.family === "viz").map((p) => p.id));
  const seen = new Set<string>();
  const extras = activated.filter((p) => {
    if (p.family !== "viz" || known.has(p.id) || seen.has(p.id)) return false;
    if (surface && !p.placeableIn.includes(surface)) return false;
    seen.add(p.id);
    return true;
  });
  return buildTree([...(surface ? primitivesFor(surface) : PRIMITIVES), ...extras]);
}

/** The category subfolders present in a family. */
export function categoriesFor(family: PrimitiveFamily): string[] {
  return uniq(primitivesByFamily(family).map((p) => p.category)).sort();
}

/** One family's subfolders (optionally scoped to a placement surface) — the shape an authoring surface
 *  renders as grouped options / a folder list. */
export function familyFolders(family: PrimitiveFamily, surface?: PlacementSurface): PrimitiveFolder[] {
  return primitiveTree(surface).find((t) => t.family === family)?.folders ?? [];
}

/** Every distinct tag across the store (for a tag filter / cloud), sorted. */
export function allTags(): string[] {
  return uniq(PRIMITIVES.flatMap((p) => p.tags)).sort();
}

/** Primitives carrying a given tag (cross-cutting, spans families/folders). */
export function primitivesByTag(tag: string): Primitive[] {
  return PRIMITIVES.filter((p) => p.tags.includes(tag));
}
