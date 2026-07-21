import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import rough from "roughjs";
import { MousePointer2, StickyNote, Square, Type, Spline, Pen, Frame, Trash2, ClipboardList } from "lucide-react";
import type { CanvasElement, CanvasElementType, ShapeKind, StickyColor } from "@workspace/backend-catalogue";
import { STICKY_COLORS, SHAPE_KINDS } from "@workspace/backend-catalogue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CanvasElements } from "./CanvasRenderer";
import { STICKY_HEX, elementBounds, newElement, moveElement, updateElement, removeElement, newElementId } from "../../lib/canvas-geometry";
import type { RemoteCursor } from "../../lib/whiteboard-cursors";

/**
 * CanvasEditor — the interactive native whiteboard editor (roadmap 2.3 slice 2). It reimplements the standard
 * canvas interaction model (pick a tool → pointer-down creates/selects, pointer-move drags/draws, pointer-up
 * commits) over OUR `canvas` primitives, rendered as SVG (the same approach — and the same MIT libs, roughjs
 * + perfect-freehand — that Excalidraw is built on, in our own model). Fully controlled: it calls
 * `onChange(elements)` on every edit so the page owns persistence through the broker seam.
 */
type Tool = "select" | "sticky" | "shape" | "text" | "connector" | "pen" | "frame";
const TOOLS: { tool: Tool; icon: typeof MousePointer2; label: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select" },
  { tool: "sticky", icon: StickyNote, label: "Sticky" },
  { tool: "shape", icon: Square, label: "Shape" },
  { tool: "text", icon: Type, label: "Text" },
  { tool: "connector", icon: Spline, label: "Connector" },
  { tool: "pen", icon: Pen, label: "Pen" },
  { tool: "frame", icon: Frame, label: "Frame" },
];

/** Imperative handle: lets the page reach the live `<svg>` (for export) without owning the editor's state. */
export interface CanvasEditorHandle { getSvg: () => SVGSVGElement | null }

export const CanvasEditor = forwardRef<CanvasEditorHandle, {
  elements: CanvasElement[];
  onChange: (next: CanvasElement[]) => void;
  readOnly?: boolean;
  /** When provided, a selected sticky offers a "Create work item" action (the page owns issue creation). */
  onConvertSticky?: ((el: CanvasElement) => void) | undefined;
  /** True while a conversion is in flight (disables the button). */
  converting?: boolean | undefined;
  /** Other users' live cursors to draw over the canvas (empty when the feature is off). */
  cursors?: RemoteCursor[] | undefined;
  /** Broadcast this tab's pointer position (SVG coords) — called on every move over the surface. */
  onCursorMove?: ((x: number, y: number) => void) | undefined;
}>(function CanvasEditor({ elements, onChange, readOnly = false, onConvertSticky, converting = false, cursors = [], onCursorMove }, ref) {
  const gen = useMemo(() => rough.generator(), []);
  const svgRef = useRef<SVGSVGElement>(null);
  useImperativeHandle(ref, () => ({ getSvg: () => svgRef.current }), []);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<StickyColor>("yellow");
  const [shape, setShape] = useState<ShapeKind>("rectangle");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CanvasElement | null>(null);
  // Transient pointer state (kept in a ref so a fast drag doesn't thrash React state).
  const drag = useRef<{ mode: "move" | "draw" | "connector"; id?: string; ox: number; oy: number; lastX: number; lastY: number } | null>(null);

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  /** Pointer position in SVG coordinates (no pan/zoom in this slice). */
  const pt = (e: React.PointerEvent): { x: number; y: number } => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** Top-most element under a point (reverse z-order), by its bounds. */
  const hit = (x: number, y: number): CanvasElement | null => {
    for (let i = elements.length - 1; i >= 0; i--) {
      const b = elementBounds(elements[i]!);
      if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) return elements[i]!;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (readOnly) return;
    const { x, y } = pt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (tool === "select") {
      const el = hit(x, y);
      setSelectedId(el?.id ?? null);
      if (el) drag.current = { mode: "move", id: el.id, ox: x, oy: y, lastX: x, lastY: y };
      return;
    }
    if (tool === "pen") {
      const el: CanvasElement = { id: newElementId(), type: "draw", x, y, points: [[0, 0]], strokeWidth: 4 };
      drag.current = { mode: "draw", id: el.id, ox: x, oy: y, lastX: x, lastY: y };
      setDraft(el);
      return;
    }
    if (tool === "connector") {
      const el: CanvasElement = { id: newElementId(), type: "connector", x, y, x2: x, y2: y };
      drag.current = { mode: "connector", id: el.id, ox: x, oy: y, lastX: x, lastY: y };
      setDraft(el);
      return;
    }
    // A one-click create tool (sticky/shape/text/frame): drop it and select it.
    const el = newElement(tool as CanvasElementType, x, y);
    if (el.type === "sticky") el.color = color;
    if (el.type === "shape") el.shape = shape;
    onChange([...elements, el]);
    setSelectedId(el.id);
    setTool("select");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const { x, y } = pt(e);
    const d = drag.current;
    if (d.mode === "move" && d.id) {
      onChange(moveElement(elements, d.id, x - d.lastX, y - d.lastY));
      d.lastX = x; d.lastY = y;
    } else if (d.mode === "draw") {
      setDraft((cur) => (cur && cur.points ? { ...cur, points: [...cur.points, [x - d.ox, y - d.oy]] } : cur));
    } else if (d.mode === "connector") {
      setDraft((cur) => (cur ? { ...cur, x2: x, y2: y } : cur));
    }
  };

  const onPointerUp = () => {
    if (draft) {
      // Commit a drawn/connector element unless it's a degenerate dot.
      const b = elementBounds(draft);
      if (draft.type === "draw" ? (draft.points?.length ?? 0) > 1 : b.w + b.h > 6) {
        onChange([...elements, draft]);
        setSelectedId(draft.id);
      }
      setDraft(null);
      setTool("select");
    }
    drag.current = null;
  };

  const patchSelected = (patch: Partial<CanvasElement>) => selected && onChange(updateElement(elements, selected.id, patch));
  const deleteSelected = () => { if (selected) { onChange(removeElement(elements, selected.id)); setSelectedId(null); } };

  return (
    <div className="flex flex-col gap-2" data-testid="canvas-editor">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2" data-testid="canvas-toolbar">
          {TOOLS.map(({ tool: t, icon: Icon, label }) => (
            <Button key={t} type="button" variant={tool === t ? "default" : "outline"} size="sm" aria-pressed={tool === t}
              data-testid={`canvas-tool-${t}`} title={label} onClick={() => setTool(t)}>
              <Icon className="h-4 w-4" />
            </Button>
          ))}
          {tool === "sticky" && (
            <div className="flex items-center gap-1 ml-2" data-testid="canvas-sticky-colors">
              {STICKY_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Sticky ${c}`} data-testid={`canvas-color-${c}`} onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded border ${color === c ? "ring-2 ring-foreground" : "border-border"}`} style={{ backgroundColor: STICKY_HEX[c] }} />
              ))}
            </div>
          )}
          {tool === "shape" && (
            <select aria-label="Shape kind" data-testid="canvas-shape-kind" value={shape} onChange={(e) => setShape(e.target.value as ShapeKind)}
              className="h-8 border border-border bg-background text-xs px-1 ml-2">
              {SHAPE_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1 border border-border rounded overflow-hidden" style={{ height: 480, touchAction: "none" }}>
          <svg ref={svgRef} width="100%" height="100%" style={{ background: "#ffffff", cursor: tool === "select" ? "default" : "crosshair" }}
            data-testid="canvas-surface" onPointerDown={onPointerDown}
            onPointerMove={(e) => { if (onCursorMove) { const p = pt(e); onCursorMove(p.x, p.y); } onPointerMove(e); }}
            onPointerUp={onPointerUp}>
            <defs>
              <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#1e1e1e" />
              </marker>
            </defs>
            <CanvasElements elements={draft ? [...elements, draft] : elements} selectedId={selectedId} gen={gen} />
            {/* Other users' live cursors (overlay; non-interactive) — drawn last so they sit on top. */}
            <g data-testid="canvas-cursors" pointerEvents="none">
              {cursors.map((c) => (
                <g key={c.cid} transform={`translate(${c.x} ${c.y})`} data-testid={`canvas-cursor-${c.cid}`}>
                  <path d="M0 0 L0 15 L4 11 L7 17 L10 15 L7 10 L12 10 Z" fill={c.color} stroke="#ffffff" strokeWidth={0.75} />
                  <rect x={13} y={2} width={c.label.length * 6 + 8} height={15} rx={3} fill={c.color} />
                  <text x={17} y={13} fontSize={9} fontWeight={600} fill="#ffffff">{c.label}</text>
                </g>
              ))}
            </g>
          </svg>
        </div>

        {/* Inspector for the selected element. */}
        {selected && !readOnly && (
          <aside className="w-52 shrink-0 border border-border rounded p-2 space-y-2" data-testid="canvas-inspector">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{selected.type}</span>
              <button type="button" aria-label="Delete element" data-testid="canvas-delete" onClick={deleteSelected} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            {(selected.type === "sticky" || selected.type === "text" || selected.type === "shape" || selected.type === "frame") && (
              <Input aria-label="Element text" data-testid="canvas-text" value={selected.text ?? ""} onChange={(e) => patchSelected({ text: e.target.value })} className="h-8 text-sm" placeholder="Text…" />
            )}
            {selected.type === "sticky" && (
              <div className="flex items-center gap-1">
                {STICKY_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Set ${c}`} onClick={() => patchSelected({ color: c })}
                    className={`h-5 w-5 rounded border ${selected.color === c ? "ring-2 ring-foreground" : "border-border"}`} style={{ backgroundColor: STICKY_HEX[c] }} />
                ))}
              </div>
            )}
            {selected.type === "sticky" && onConvertSticky && (
              <Button type="button" variant="outline" size="sm" className="w-full" data-testid="canvas-to-issue"
                disabled={converting || !selected.text?.trim()} onClick={() => onConvertSticky(selected)}>
                <ClipboardList className="h-3 w-3 mr-1" />{converting ? "Creating…" : "Create work item"}
              </Button>
            )}
            {selected.type === "shape" && (
              <select aria-label="Selected shape kind" value={selected.shape ?? "rectangle"} onChange={(e) => patchSelected({ shape: e.target.value as ShapeKind })} className="h-8 border border-border bg-background text-xs px-1 w-full">
                {SHAPE_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </aside>
        )}
      </div>
    </div>
  );
});
