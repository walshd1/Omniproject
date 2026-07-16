import getStroke from "perfect-freehand";
import type { CanvasElement, CanvasElementType, StickyColor } from "@workspace/backend-catalogue";

/**
 * Pure geometry + reducers for the native whiteboard canvas (roadmap 2.3 slice 2). The canvas is rendered as
 * SVG from our `canvas` primitives; these helpers (colours, bounds, freehand→path, add/move/update/remove)
 * are side-effect-free so the interaction logic is unit-testable without a DOM. Freehand strokes use
 * `perfect-freehand` (MIT); the sketchy shape look uses `roughjs` (MIT) inside the renderer component.
 */

/** Named sticky colours → the actual swatch the renderer paints (the model stores the NAME, not raw hex). */
export const STICKY_HEX: Record<StickyColor, string> = {
  yellow: "#fef08a", green: "#bbf7d0", blue: "#bfdbfe", pink: "#fbcfe8", gray: "#e5e7eb",
};
export const stickyHex = (c: string | undefined): string => STICKY_HEX[(c as StickyColor)] ?? STICKY_HEX.yellow;

/** A deterministic small seed from an element id, so a roughjs sketch is STABLE across re-renders (no jitter). */
export function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2_000_000) + 1;
}

/** The axis-aligned bounds of an element (selection outline / hit-testing). */
export function elementBounds(el: CanvasElement): { x: number; y: number; w: number; h: number } {
  if (el.type === "connector") {
    const x2 = el.x2 ?? el.x, y2 = el.y2 ?? el.y;
    return { x: Math.min(el.x, x2), y: Math.min(el.y, y2), w: Math.abs(x2 - el.x), h: Math.abs(y2 - el.y) };
  }
  if (el.type === "draw" && el.points?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [px, py] of el.points) { minX = Math.min(minX, px!); minY = Math.min(minY, py!); maxX = Math.max(maxX, px!); maxY = Math.max(maxY, py!); }
    return { x: el.x + minX, y: el.y + minY, w: maxX - minX, h: maxY - minY };
  }
  if (el.type === "text") return { x: el.x, y: el.y, w: 220, h: (el.fontSize ?? 16) * 1.6 };
  return { x: el.x, y: el.y, w: el.w ?? 120, h: el.h ?? 80 };
}

/** Standard perfect-freehand → SVG path recipe (quadratic segments through the outline). */
export function strokeToPath(points: number[][], strokeWidth = 4): string {
  const outline = getStroke(points, { size: strokeWidth * 2, thinning: 0.6, smoothing: 0.5, streamline: 0.5 });
  if (!outline.length) return "";
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
      return acc;
    },
    ["M", ...outline[0]!, "Q"],
  );
  d.push("Z");
  return d.join(" ");
}

let idSeq = 0;
/** A fresh element id (unique within a session). */
export function newElementId(): string {
  return `el-${Date.now().toString(36)}-${idSeq++}`;
}

/** A new element of a given type at (x, y), with sensible defaults. */
export function newElement(type: CanvasElementType, x: number, y: number, id = newElementId()): CanvasElement {
  switch (type) {
    case "sticky": return { id, type, x, y, w: 160, h: 120, text: "", color: "yellow" };
    case "shape": return { id, type, x, y, w: 120, h: 80, shape: "rectangle" };
    case "text": return { id, type, x, y, text: "Text", fontSize: 18 };
    case "connector": return { id, type, x, y, x2: x + 120, y2: y };
    case "frame": return { id, type, x, y, w: 320, h: 240, text: "Frame" };
    case "draw": return { id, type, x, y, points: [[0, 0]], strokeWidth: 4 };
  }
}

/** Move an element by (dx, dy) — shifting the connector's far end too. Pure (returns a new list). */
export function moveElement(els: readonly CanvasElement[], id: string, dx: number, dy: number): CanvasElement[] {
  return els.map((e) => {
    if (e.id !== id) return e;
    const moved: CanvasElement = { ...e, x: e.x + dx, y: e.y + dy };
    if (e.type === "connector") { moved.x2 = (e.x2 ?? e.x) + dx; moved.y2 = (e.y2 ?? e.y) + dy; }
    return moved;
  });
}

/** Patch an element's fields. Pure. */
export function updateElement(els: readonly CanvasElement[], id: string, patch: Partial<CanvasElement>): CanvasElement[] {
  return els.map((e) => (e.id === id ? { ...e, ...patch } : e));
}

/** Remove an element. Pure. */
export function removeElement(els: readonly CanvasElement[], id: string): CanvasElement[] {
  return els.filter((e) => e.id !== id);
}
