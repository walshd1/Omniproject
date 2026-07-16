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
  family: PrimitiveFamily;
  label: string;
  /** Sub-grouping for the palette (e.g. viz "chart"/"graphic"/"tile"; field "input"). */
  category?: string;
  /** Where an author may place this primitive. */
  placeableIn: PlacementSurface[];
}

const titleCase = (s: string): string => s.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** `panel` family — every registered screen panel kind. Panels live on screens. */
function panelPrimitives(): Primitive[] {
  return Object.keys(PANEL_RENDERERS).map((id) => ({ id, family: "panel", label: titleCase(id), category: "panel", placeableIn: ["screen"] }));
}

/** `viz` family — the data-visualisation primitives (shared by chart panels AND reports). */
function vizPrimitives(): Primitive[] {
  return PRIMITIVE_LIBRARY.map((p) => ({
    id: p.id,
    family: "viz",
    label: p.label ?? titleCase(p.id),
    category: p.category,
    placeableIn: ["screen", "report", "dashboard", "content"],
  }));
}

/** `field` family — the form input controls. Fields live on forms. */
function fieldPrimitives(): Primitive[] {
  return FORM_FIELD_TYPES.map((id) => ({ id, family: "field", label: titleCase(id), category: "input", placeableIn: ["form"] }));
}

/** `component` family — hosted reports + widgets, already placement-tagged by the shared library. */
function componentPrimitives(): Primitive[] {
  return componentLibrary().map((c) => ({
    id: c.id,
    family: "component",
    label: c.label,
    category: c.category,
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
