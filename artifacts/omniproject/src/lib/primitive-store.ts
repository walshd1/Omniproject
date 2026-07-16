import { PANEL_RENDERERS } from "../components/screen/registry";
import { PRIMITIVE_LIBRARY } from "../definitions/primitives";
import { componentLibrary, FORM_FIELD_TYPES } from "@workspace/backend-catalogue";

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
 */
export type PrimitiveFamily = "panel" | "viz" | "field" | "component";
export type PlacementSurface = "screen" | "report" | "dashboard" | "content" | "form" | "export";

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
  number: { category: "numeric", tags: [] },
  date: { category: "temporal", tags: [] },
  select: { category: "choice", tags: [] },
  checkbox: { category: "boolean", tags: [] },
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

const FAMILY_ORDER: PrimitiveFamily[] = ["panel", "viz", "field", "component"];

/**
 * The store as a browsable TREE — family → category subfolders → primitives. Optionally scoped to one
 * placement surface (e.g. build the "what can I drop on a screen" palette with `primitiveTree("screen")`).
 * Empty families/folders are omitted; categories are alphabetical within a family.
 */
export function primitiveTree(surface?: PlacementSurface): PrimitiveFamilyTree[] {
  const source = surface ? primitivesFor(surface) : PRIMITIVES;
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
