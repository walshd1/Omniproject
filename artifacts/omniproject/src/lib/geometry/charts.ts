import type { GeometryShape } from "../../components/geometry/GeometryCanvas";
import { linearScale, niceTicks } from "./scale";

/**
 * Chart builders that compose a data chart PURELY from geometry atoms — the proof that the chart
 * primitives break down to fundamentals. Each is a pure `data → GeometryShape[]` function: it scales
 * the data into canvas coordinates (see scale.ts) and emits `rect` bars, `line` gridlines/series and
 * `text` labels. No SVG, no charting library — {@link GeometryCanvas} draws the atoms.
 *
 * These render static charts from atoms. Data-dense INTERACTIVE charts (hover tooltips, live legends)
 * still have a place for a specialised renderer; this is the atomic baseline every chart traces to.
 */

const AXIS = "#9ca3af"; // muted axis/gridline colour
const GRID = "#e5e7eb"; // faint gridline colour

export interface ColumnDatum {
  label: string;
  value: number;
}

export interface ColumnChartSpec {
  data: ColumnDatum[];
  width: number;
  height: number;
  /** Inner padding for axis labels/ticks (user units). */
  pad?: number;
  /** Bar fill colour (one colour for all bars). */
  barColor?: string;
  /** Draw horizontal value gridlines at the nice ticks (default true). */
  gridlines?: boolean;
}

/**
 * A column (vertical bar) chart composed from atoms: a value axis (nice-tick gridlines + tick `text`),
 * one `rect` bar per datum scaled to the value axis, a baseline `line`, and category `text` labels.
 * Non-positive/absent values render a zero-height bar (nothing drawn), never a negative rect.
 */
export function buildColumnChart(spec: ColumnChartSpec): GeometryShape[] {
  const { data, width, height, pad = 16, barColor = "#2563eb", gridlines = true } = spec;
  const shapes: GeometryShape[] = [];
  const plotLeft = pad * 2; // room for y tick labels
  const plotRight = width - pad;
  const plotTop = pad;
  const plotBottom = height - pad * 1.5; // room for x labels
  const plotW = Math.max(0, plotRight - plotLeft);

  const maxVal = Math.max(0, ...data.map((d) => (Number.isFinite(d.value) ? d.value : 0)));
  const ticks = niceTicks(0, maxVal || 1);
  const yMax = ticks[ticks.length - 1] || 1;
  const y = linearScale([0, yMax], [plotBottom, plotTop]); // value → canvas (inverted)

  // Value gridlines + tick labels.
  if (gridlines) {
    for (const t of ticks) {
      const gy = y(t);
      shapes.push({ type: "line", x1: plotLeft, y1: gy, x2: plotRight, y2: gy, stroke: GRID, thickness: 1 });
      shapes.push({ type: "text", x: plotLeft - 4, y: gy + 3, content: String(t), size: 8, fill: AXIS, anchor: "end" });
    }
  }

  // Baseline (value axis zero).
  shapes.push({ type: "line", x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, stroke: AXIS, thickness: 1 });

  // Bars — evenly spaced across the plot width with a gap either side of each.
  const n = data.length;
  if (n > 0 && plotW > 0) {
    const slot = plotW / n;
    const barW = slot * 0.6;
    data.forEach((d, i) => {
      const v = Number.isFinite(d.value) ? Math.max(0, d.value) : 0;
      const bx = plotLeft + i * slot + (slot - barW) / 2;
      const top = y(v);
      const barH = Math.max(0, plotBottom - top);
      // The bar carries its own data label as `hover` — the interactive canvas turns that into a
      // tooltip + accessible announcement, so the chart is interactive with no charting library.
      if (barH > 0) shapes.push({ type: "rect", x: bx, y: top, width: barW, height: barH, fill: barColor, hover: `${d.label}: ${v}` });
      shapes.push({ type: "text", x: bx + barW / 2, y: plotBottom + 10, content: d.label, size: 8, fill: AXIS, anchor: "middle" });
    });
  }
  return shapes;
}

export interface SparklineSpec {
  values: number[];
  width: number;
  height: number;
  stroke?: string;
  thickness?: number;
  /** Mark each vertex with a `point` atom. */
  showPoints?: boolean;
  /** Inner vertical padding so the peak/trough aren't clipped (user units). */
  pad?: number;
}

/**
 * A sparkline composed from atoms: consecutive values scaled across the width and joined by `line`
 * segments (optionally marked with `point`s). A single value renders one centred point; empty renders
 * nothing.
 */
export function buildSparkline(spec: SparklineSpec): GeometryShape[] {
  const { values, width, height, stroke = "#2563eb", thickness = 1.5, showPoints = false, pad = 2 } = spec;
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const x = linearScale([0, Math.max(1, values.length - 1)], [0, width]);
  const y = linearScale([lo, hi], [height - pad, pad]); // value → canvas (inverted), padded
  const pts = values.map((v, i) => ({ x: x(i), y: Number.isFinite(v) ? y(v) : y((lo + hi) / 2) }));

  const shapes: GeometryShape[] = [];
  for (let i = 1; i < pts.length; i++) {
    shapes.push({ type: "line", x1: pts[i - 1]!.x, y1: pts[i - 1]!.y, x2: pts[i]!.x, y2: pts[i]!.y, stroke, thickness });
  }
  if (showPoints || pts.length === 1) {
    for (const p of pts) shapes.push({ type: "point", x: p.x, y: p.y, r: thickness, fill: stroke });
  }
  return shapes;
}
