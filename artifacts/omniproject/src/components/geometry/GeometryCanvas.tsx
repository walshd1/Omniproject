import { useState } from "react";
import { numLoose } from "../../lib/num";

/**
 * GeometryCanvas — the read-only SVG renderer for the GEOMETRY atom tier (roadmap: keep primitives
 * fundamental, compose up). It draws the drawable-plane atoms — `line`, `rect`, `text`, `point`,
 * `path` — straight from their JSON params (the same keys the shared primitive catalogue declares), so
 * a chart / gantt / diagram / visual grid is just a list of atom instances rendered here with no
 * bespoke component. Params are read tolerantly (system JSON is stringly-typed at the edges) with the
 * catalogue's documented defaults; an unknown `type` is skipped rather than throwing.
 *
 * INTERACTIVITY is an ADDITIVE layer, not a separate canvas: the taxonomy is canvas → atoms →
 * composition → interaction. All charts sit on the canvas; not all are interactive, so `interactive`
 * is a declarative key (from the def) — when true, any atom carrying a `hover` string becomes a
 * focusable region with a pointer/keyboard tooltip, announced to assistive tech; when false the very
 * same atoms render statically. No charting library, no resize observers (the viewBox scales).
 *
 * This is the DRAWABLE plane only. The semantic plane (tables/tiles) is NOT drawn here — it stays
 * accessible DOM and composes via the def `extends` lineage.
 */

/** One geometry-atom instance to draw: the atom's `type` plus its params (as they arrive from JSON).
 *  `hover` (optional) is tooltip/accessible text used ONLY by the interactive canvas — the static
 *  renderer ignores it, so a chart's shapes carry their own data label without a separate channel. */
export interface GeometryShape {
  type: string;
  hover?: string;
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

/** Render one atom instance as an SVG element. Unknown types render nothing (fail-soft). Exported so
 *  the interactive canvas can wrap the same atoms with hover/focus behaviour. */
export function GeometryAtom({ s }: { s: GeometryShape }) {
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
    case "path":
      return (
        <path
          d={strOr(s["d"], "")}
          fill={strOr(s["fill"], "none")}
          {...(typeof s["stroke"] === "string" && s["stroke"] ? { stroke: s["stroke"] as string, strokeWidth: numOr(s["thickness"], 1) } : {})}
        />
      );
    default:
      return null;
  }
}

/**
 * Draw a list of geometry-atom instances in a responsive SVG viewport (`0 0 width height` user units).
 * Give a `title` when the drawing conveys meaning (rendered as an accessible label); omit it for a
 * purely decorative drawing, which is then hidden from assistive tech. Set `interactive` (the def's
 * key) to additively enable the hover/focus tooltip layer over any atom that carries a `hover` string.
 */
export function GeometryCanvas({
  shapes,
  width = 100,
  height = 100,
  className,
  title,
  interactive = false,
}: {
  shapes: GeometryShape[];
  /** Coordinate-space width (user units); the SVG scales to its container. */
  width?: number;
  height?: number;
  className?: string;
  /** Accessible label for a meaningful drawing; when omitted the SVG is aria-hidden (decorative). */
  title?: string;
  /** ADDITIVE interaction layer (a declarative def key): tooltips on the atoms' `hover` text. */
  interactive?: boolean;
}) {
  // Tooltip state is only ever set on the interactive path; it stays null for a static canvas.
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const show = (text: string) => (e: React.MouseEvent<SVGGElement> | React.FocusEvent<SVGGElement>) => {
    const host = e.currentTarget.closest("[data-geometry-host]") as HTMLElement | null;
    const box = e.currentTarget.getBoundingClientRect();
    const hostBox = host?.getBoundingClientRect();
    setTip({ x: hostBox ? box.left - hostBox.left + box.width / 2 : 0, y: hostBox ? box.top - hostBox.top : 0, text });
  };
  const hide = () => setTip(null);

  return (
    <div className={`relative ${className ?? ""}`.trim()} data-geometry-host>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        data-testid="geometry-canvas"
        {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      >
        {title && <title>{title}</title>}
        {shapes.map((s, i) =>
          interactive && typeof s.hover === "string" && s.hover ? (
            <g
              key={i}
              tabIndex={0}
              role="img"
              aria-label={s.hover}
              onMouseEnter={show(s.hover)}
              onMouseLeave={hide}
              onFocus={show(s.hover)}
              onBlur={hide}
              className="outline-none [&:focus-visible>*]:opacity-80"
            >
              <GeometryAtom s={s} />
            </g>
          ) : (
            <GeometryAtom key={i} s={s} />
          ),
        )}
      </svg>
      {tip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
