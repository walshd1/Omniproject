import { useMemo } from "react";
import rough from "roughjs";
import type { RoughGenerator } from "roughjs/bin/generator";
import type { CanvasElement } from "@workspace/backend-catalogue";
import { stickyHex, seedFromId, strokeToPath, elementBounds } from "../../lib/canvas-geometry";

/**
 * CanvasRenderer — the read-only SVG renderer for a whiteboard, built from our `canvas` primitives (roadmap
 * 2.3). Each element type renders declaratively: a sticky is a coloured note, a shape is drawn with the
 * hand-drawn `roughjs` look (deterministic per element id so it doesn't jitter), text/frames are plain, a
 * connector is a lined arrow, and a freehand `draw` element is a `perfect-freehand` outline path. Nothing is
 * interactive here — the editor composes `CanvasElements` inside its own interactive <svg>.
 */

/** Render the elements as SVG children (shared by the read-only renderer AND the editor's canvas). */
export function CanvasElements({ elements, selectedId, gen }: {
  elements: readonly CanvasElement[];
  selectedId?: string | null;
  gen: RoughGenerator;
}) {
  return (
    <>
      {elements.map((el) => (
        <g key={el.id} data-testid={`canvas-el-${el.id}`} data-kind={el.type}>
          <CanvasElementShape el={el} gen={gen} />
          {selectedId === el.id && <SelectionOutline el={el} />}
        </g>
      ))}
    </>
  );
}

function SelectionOutline({ el }: { el: CanvasElement }) {
  const b = elementBounds(el);
  return (
    <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8}
      fill="none" stroke="#2563eb" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" data-testid="canvas-selection" />
  );
}

function CanvasElementShape({ el, gen }: { el: CanvasElement; gen: RoughGenerator }) {
  const w = el.w ?? 120;
  const h = el.h ?? 80;

  if (el.type === "sticky") {
    return (
      <g>
        <rect x={el.x} y={el.y} width={w} height={h} rx={4} fill={stickyHex(el.color)} stroke="#00000022" />
        <foreignObject x={el.x} y={el.y} width={w} height={h}>
          <div style={{ padding: 6, fontSize: 13, lineHeight: 1.3, wordBreak: "break-word", color: "#1e1e1e", height: "100%", overflow: "hidden" }}>
            {el.text}
          </div>
        </foreignObject>
      </g>
    );
  }

  if (el.type === "shape") {
    const opts = { seed: seedFromId(el.id), roughness: 1.1, stroke: "#1e1e1e", strokeWidth: 2 } as const;
    const cx = el.x + w / 2, cy = el.y + h / 2;
    const drawable =
      el.shape === "ellipse" ? gen.ellipse(cx, cy, w, h, opts)
      : el.shape === "diamond" ? gen.polygon([[cx, el.y], [el.x + w, cy], [cx, el.y + h], [el.x, cy]], opts)
      : gen.rectangle(el.x, el.y, w, h, opts);
    const paths = gen.toPaths(drawable);
    return (
      <g>
        {paths.map((p, i) => (
          <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill || "none"} />
        ))}
        {el.text && (
          <foreignObject x={el.x} y={el.y} width={w} height={h}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontSize: 12, textAlign: "center", padding: 4 }}>{el.text}</div>
          </foreignObject>
        )}
      </g>
    );
  }

  if (el.type === "text") {
    return (
      <foreignObject x={el.x} y={el.y} width={240} height={(el.fontSize ?? 16) * 3}>
        <div style={{ fontSize: el.fontSize ?? 18, color: "#1e1e1e", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{el.text}</div>
      </foreignObject>
    );
  }

  if (el.type === "connector") {
    const x2 = el.x2 ?? el.x, y2 = el.y2 ?? el.y;
    return <line x1={el.x} y1={el.y} x2={x2} y2={y2} stroke="#1e1e1e" strokeWidth={2} markerEnd="url(#wb-arrow)" />;
  }

  if (el.type === "frame") {
    return (
      <g>
        <rect x={el.x} y={el.y} width={w} height={h} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 4" rx={6} />
        <foreignObject x={el.x} y={el.y - 20} width={w} height={20}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>{el.text}</div>
        </foreignObject>
      </g>
    );
  }

  if (el.type === "draw" && el.points?.length) {
    return <path d={strokeToPath(el.points, el.strokeWidth)} transform={`translate(${el.x} ${el.y})`} fill="#1e1e1e" />;
  }

  return null;
}

/** The read-only whiteboard render (its own <svg> + the arrowhead marker). */
export function CanvasRenderer({ elements, background = "#ffffff", testId = "canvas-render" }: {
  elements: readonly CanvasElement[];
  background?: string;
  testId?: string;
}) {
  const gen = useMemo(() => rough.generator(), []);
  return (
    <svg width="100%" height="100%" style={{ background }} data-testid={testId}>
      <defs>
        <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e1e1e" />
        </marker>
      </defs>
      <CanvasElements elements={elements} gen={gen} />
    </svg>
  );
}
