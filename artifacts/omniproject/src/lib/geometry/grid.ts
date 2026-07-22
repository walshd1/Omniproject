import type { GeometryShape } from "../../components/geometry/GeometryCanvas";

/**
 * Grid composition — the FIRST proof that a higher-level drawable is built purely from geometry
 * ATOMS. A grid is not a bespoke component: it is a list of `line` atoms at regular intervals
 * (horizontals every `rowGap`, verticals every `colGap`), each carrying the same per-instance style
 * (stroke / thickness / dash) applied from its spec — exactly the "lines across at intervals" model.
 * The output is plain `GeometryShape[]`, rendered by {@link GeometryCanvas}; nothing here touches SVG.
 *
 * This is the DRAWABLE plane (chart gridlines, gantt backgrounds, graph paper). It is NOT the semantic
 * data table — that stays accessible DOM.
 */

export interface GridSpec {
  /** Canvas width in user units (verticals span 0..width; horizontals run the full width). */
  width: number;
  /** Canvas height in user units. */
  height: number;
  /** Spacing between horizontal gridlines (user units). Omitted/≤0 ⇒ no horizontal lines. */
  rowGap?: number;
  /** Spacing between vertical gridlines. Omitted/≤0 ⇒ no vertical lines. */
  colGap?: number;
  /** Per-instance line style, applied to every gridline. */
  stroke?: string;
  thickness?: number;
  dash?: string;
}

/** Evenly-spaced offsets from 0 to `extent` inclusive at `gap` steps (count-based, so no float drift).
 *  Empty when `gap` isn't a positive finite number. */
function offsets(extent: number, gap: number | undefined): number[] {
  if (!gap || !Number.isFinite(gap) || gap <= 0 || !Number.isFinite(extent) || extent < 0) return [];
  const n = Math.floor(extent / gap + 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => i * gap);
}

/**
 * Build a grid as a list of `line` atoms. Horizontals sit at each `rowGap` down the height; verticals
 * at each `colGap` across the width; the boundary lines (0 and the far edge) are included. Every line
 * carries the spec's stroke/thickness/dash so the whole grid restyles by changing the spec — the atoms
 * are identical instances differing only in position.
 */
export function buildGrid(spec: GridSpec): GeometryShape[] {
  const { width, height, rowGap, colGap, stroke, thickness, dash } = spec;
  const style = {
    ...(stroke !== undefined ? { stroke } : {}),
    ...(thickness !== undefined ? { thickness } : {}),
    ...(dash !== undefined ? { dash } : {}),
  };
  const shapes: GeometryShape[] = [];
  // Horizontal gridlines run left→right at each row offset.
  for (const y of offsets(height, rowGap)) shapes.push({ type: "line", x1: 0, y1: y, x2: width, y2: y, ...style });
  // Vertical gridlines run top→bottom at each column offset.
  for (const x of offsets(width, colGap)) shapes.push({ type: "line", x1: x, y1: 0, x2: x, y2: height, ...style });
  return shapes;
}
