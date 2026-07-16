/**
 * WHITEBOARD / canvas content model — the neutral, primitive-built shape for OmniProject's visual canvas
 * (roadmap 2.3). Same architectural principle as documents (wiki blocks), forms, screens and reports: a
 * whiteboard is a JSON DEFINITION built of typed CANVAS-ELEMENT PRIMITIVES, authored once and rendered by a
 * generic renderer — NOT an opaque third-party scene blob.
 *
 * A whiteboard scene is an ordered list of `CanvasElement`s. Each element TYPE is a small primitive (its
 * config are properties; it renders and validates by its type). The single `CANVAS_ELEMENT_TYPES` list is
 * what the authoring palette, the validator AND the unified primitive store (the `canvas` family) all draw
 * from, so the store can never drift from what a canvas can contain. Because the model is ours, a rich
 * third-party editor (Excalidraw/Miro) is an OPTIONAL "use native" enhancement, not the source of truth.
 *
 * Scenes are stored through the broker seam (zero-at-rest); this module defines the neutral shape only —
 * the authoritative sanitiser runs server-side before anything is written.
 */

/**
 * The supported canvas element types. `sticky` — a coloured sticky note (the staple); `shape` — a
 * rectangle/ellipse/diamond (optionally labelled); `text` — free-standing text; `connector` — a line/arrow
 * between two points or elements; `frame` — a labelled grouping container.
 */
export type CanvasElementType = "sticky" | "shape" | "text" | "connector" | "frame";

/** The canvas element primitives, as a value — the single list the palette, validator and primitive store
 *  (`canvas` family) all draw from, so the family can't drift from the CanvasElementType union. */
export const CANVAS_ELEMENT_TYPES: readonly CanvasElementType[] = ["sticky", "shape", "text", "connector", "frame"];

/** The element types that carry a width/height box (sticky/shape/frame). */
export const BOXED_CANVAS_TYPES: readonly CanvasElementType[] = ["sticky", "shape", "frame"];

/** The shapes a `shape` element can be. */
export type ShapeKind = "rectangle" | "ellipse" | "diamond";
export const SHAPE_KINDS: readonly ShapeKind[] = ["rectangle", "ellipse", "diamond"];

/** The palette of sticky-note colours (named, not raw hex — so the renderer owns the actual values). */
export type StickyColor = "yellow" | "green" | "blue" | "pink" | "gray";
export const STICKY_COLORS: readonly StickyColor[] = ["yellow", "green", "blue", "pink", "gray"];

/**
 * One element on a whiteboard. Which optional fields apply depends on `type`: `sticky` uses text+color+box;
 * `shape` uses shape+box (+optional text label); `text` uses text+fontSize; `connector` uses the end point
 * `x2/y2` (start is `x/y`) and may bind to element ids via `from`/`to`; `frame` uses text (its label)+box.
 * A generic renderer switches on `type`. `link` (any type) is an OPTIONAL external reference — e.g. a sticky
 * that links to a work item — restricted to safe schemes by the sanitiser (zero-at-rest, never inlined).
 */
export interface CanvasElement {
  /** Stable id within the scene (for keys, connector binding, live-cursor anchoring). */
  id: string;
  type: CanvasElementType;
  /** Top-left position on the infinite canvas. */
  x: number;
  y: number;
  /** Box size — sticky / shape / frame. */
  w?: number;
  h?: number;
  /** Text — a sticky's note, a shape's label, a text element's body, a frame's label. */
  text?: string;
  /** Sticky colour. */
  color?: StickyColor;
  /** Shape kind. */
  shape?: ShapeKind;
  /** Text size for a `text` element. */
  fontSize?: number;
  /** Connector end point (its start is `x`/`y`). */
  x2?: number;
  y2?: number;
  /** Optional connector endpoints bound to element ids (so the line follows them). */
  from?: string;
  to?: string;
  /** Optional external reference (safe scheme only) — the content lives elsewhere (zero-at-rest). */
  link?: string;
}

/** Bounds the sanitiser enforces on a scene. */
export const CANVAS_LIMITS = {
  maxName: 120,
  maxElements: 5000,
  maxText: 5000,
  /** Cap on the serialised scene so a client can't push an unbounded blob into the store. */
  maxSceneBytes: 3_000_000,
} as const;
