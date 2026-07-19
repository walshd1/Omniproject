import { useState } from "react";
import { GeometryAtom, type GeometryShape } from "./GeometryCanvas";

/**
 * InteractiveGeometryCanvas — the atom canvas with HOVER/FOCUS tooltips, so a chart composed from
 * geometry atoms gets the interactivity that used to require a charting library, with NO library.
 * Any shape carrying a `hover` string becomes an interactive, keyboard-focusable region: pointing at
 * it (or tabbing to it) reveals a tooltip and announces its label to assistive tech. Shapes without
 * `hover` render exactly as the static canvas. Responsiveness comes from the SVG viewBox scaling to
 * the container width, so no resize observers are needed.
 */
export function InteractiveGeometryCanvas({
  shapes,
  width = 100,
  height = 100,
  className,
  title,
}: {
  shapes: GeometryShape[];
  width?: number;
  height?: number;
  className?: string;
  title?: string;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Position the tooltip above the centre of the hovered/focused shape, relative to the container.
  const show = (text: string) => (e: React.MouseEvent<SVGGElement> | React.FocusEvent<SVGGElement>) => {
    const host = e.currentTarget.closest("[data-geometry-host]") as HTMLElement | null;
    const box = e.currentTarget.getBoundingClientRect();
    const hostBox = host?.getBoundingClientRect();
    if (hostBox) setTip({ x: box.left - hostBox.left + box.width / 2, y: box.top - hostBox.top, text });
    else setTip({ x: 0, y: 0, text });
  };
  const hide = () => setTip(null);

  return (
    <div className={`relative ${className ?? ""}`.trim()} data-geometry-host>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-auto"
        data-testid="interactive-geometry-canvas"
        {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
      >
        {title && <title>{title}</title>}
        {shapes.map((s, i) =>
          typeof s.hover === "string" && s.hover ? (
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
            <g key={i}>
              <GeometryAtom s={s} />
            </g>
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
