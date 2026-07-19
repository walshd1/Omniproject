import { numLoose } from "../../lib/num";

/**
 * GeometryCanvas — the read-only SVG renderer for the GEOMETRY atom tier (roadmap: keep primitives
 * fundamental, compose up). It draws the four drawable-plane atoms — `line`, `rect`, `text`, `point`
 * — straight from their JSON params (the same param keys the shared primitive catalogue declares), so
 * a chart / gantt / diagram / visual grid can be expressed as a list of atom instances and rendered
 * here with no bespoke component. Every param is read tolerantly (system JSON is stringly-typed at the
 * edges) with the catalogue's documented defaults; an unknown `type` is skipped rather than throwing.
 *
 * This is the DRAWABLE plane only. The semantic plane (tables/tiles) is NOT drawn here — it stays
 * accessible DOM and composes via the def `extends` lineage.
 */

/** One geometry-atom instance to draw: the atom's `type` plus its params (as they arrive from JSON). */
export interface GeometryShape {
  type: string;
  [key: string]: unknown;
}

/** Coerce a param to a number, using `fallback` when the key is absent/blank (never NaN). */
function numOr(v: unknown, fallback: number): number {
  return v === undefined || v === null || v === "" ? fallback : numLoose(v);
}
/** Read a string param, using `fallback` when absent/non-string. */
function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

const FOREGROUND = "currentColor";

/** Render one atom instance as an SVG element. Unknown types render nothing (fail-soft). */
function Atom({ s }: { s: GeometryShape }) {
  switch (s.type) {
    case "line":
      return (
        <line
          x1={numLoose(s["x1"])}
          y1={numLoose(s["y1"])}
          x2={numLoose(s["x2"])}
          y2={numLoose(s["y2"])}
          stroke={strOr(s["stroke"], FOREGROUND)}
          strokeWidth={numOr(s["thickness"], 1)}
          {...(typeof s["dash"] === "string" && s["dash"] ? { strokeDasharray: s["dash"] as string } : {})}
        />
      );
    case "rect":
      return (
        <rect
          x={numLoose(s["x"])}
          y={numLoose(s["y"])}
          width={Math.max(0, numLoose(s["width"]))}
          height={Math.max(0, numLoose(s["height"]))}
          fill={strOr(s["fill"], "none")}
          {...(typeof s["stroke"] === "string" && s["stroke"] ? { stroke: s["stroke"] as string, strokeWidth: numOr(s["thickness"], 1) } : {})}
          {...(numOr(s["radius"], 0) > 0 ? { rx: numOr(s["radius"], 0) } : {})}
        />
      );
    case "text":
      return (
        <text
          x={numLoose(s["x"])}
          y={numLoose(s["y"])}
          fontSize={numOr(s["size"], 12)}
          fill={strOr(s["fill"], FOREGROUND)}
          fontWeight={s["weight"] === "bold" ? "bold" : "normal"}
          textAnchor={s["anchor"] === "middle" ? "middle" : s["anchor"] === "end" ? "end" : "start"}
        >
          {strOr(s["content"], "")}
        </text>
      );
    case "point":
      return (
        <circle
          cx={numLoose(s["x"])}
          cy={numLoose(s["y"])}
          r={numOr(s["r"], 2)}
          fill={strOr(s["fill"], FOREGROUND)}
        />
      );
    default:
      return null;
  }
}

/**
 * Draw a list of geometry-atom instances in a responsive SVG viewport (`0 0 width height` user units).
 * Give a `title` when the drawing conveys meaning (rendered as an accessible label); omit it for a
 * purely decorative drawing, which is then hidden from assistive tech.
 */
export function GeometryCanvas({
  shapes,
  width = 100,
  height = 100,
  className,
  title,
}: {
  shapes: GeometryShape[];
  /** Coordinate-space width (user units); the SVG scales to its container. */
  width?: number;
  height?: number;
  className?: string;
  /** Accessible label for a meaningful drawing; when omitted the SVG is aria-hidden (decorative). */
  title?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      data-testid="geometry-canvas"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {title && <title>{title}</title>}
      {shapes.map((s, i) => (
        <Atom key={i} s={s} />
      ))}
    </svg>
  );
}
