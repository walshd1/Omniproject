import { useRef, useState } from "react";
import { MousePointer2, MapPin, Square, Highlighter, Trash2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Annotation, AnnotationType, Deliverable } from "@workspace/backend-catalogue";
import { toNorm, placeAnnotation, moveAnnotation, newAnnotationId } from "../../lib/proof-geometry";

/**
 * AnnotationOverlay — the interactive proof-review surface (roadmap 2.4 slice 2). Renders the deliverable
 * (image inline, PDF via <object> with a link fallback) and overlays typed `annotation` primitives
 * (pin/box/highlight) at NORMALISED coordinates, so a marker survives any render scale. Fully controlled: it
 * calls `onChange(annotations)` on every edit so the page owns persistence through the storage seam. A
 * create tool places an annotation on click; the select tool moves one by drag; the inspector edits/deletes
 * the selected one. Read-only mode hides all editing (a viewer still sees the markers).
 */
type Tool = "select" | AnnotationType;

const TOOLS: { tool: Tool; icon: typeof MousePointer2; label: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select" },
  { tool: "pin", icon: MapPin, label: "Pin" },
  { tool: "box", icon: Square, label: "Box" },
  { tool: "highlight", icon: Highlighter, label: "Highlight" },
];

const pct = (n: number): string => `${(n * 100).toFixed(3)}%`;

export function AnnotationOverlay({ deliverable, annotations, onChange, readOnly = false }: {
  deliverable: Deliverable;
  annotations: Annotation[];
  onChange: (next: Annotation[]) => void;
  readOnly?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const drag = useRef<{ id: string } | null>(null);

  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  const rect = () => surfaceRef.current!.getBoundingClientRect();

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    if (readOnly || tool === "select") return;
    const at = toNorm(e.clientX, e.clientY, rect());
    const ann = placeAnnotation(tool, at, newAnnotationId());
    onChange([...annotations, ann]);
    setSelectedId(ann.id);
    setTool("select");
  };

  const onMarkerPointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setSelectedId(id);
    if (readOnly || tool !== "select") return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { id };
  };
  const onSurfacePointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const at = toNorm(e.clientX, e.clientY, rect());
    onChange(annotations.map((a) => (a.id === drag.current!.id ? moveAnnotation(a, at) : a)));
  };
  const onSurfacePointerUp = () => { drag.current = null; };

  const patch = (p: Partial<Annotation>) => selected && onChange(annotations.map((a) => (a.id === selected.id ? { ...a, ...p } : a)));
  const toggleResolved = (checked: boolean) => selected && onChange(annotations.map((a) => {
    if (a.id !== selected.id) return a;
    const { resolved: _drop, ...rest } = a; // set/clear without assigning `undefined` (exactOptionalPropertyTypes)
    return checked ? { ...rest, resolved: true } : rest;
  }));
  const remove = () => { if (selected) { onChange(annotations.filter((a) => a.id !== selected.id)); setSelectedId(null); } };

  return (
    <div className="flex flex-col gap-2" data-testid="annotation-overlay">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-2" data-testid="annotation-toolbar">
          {TOOLS.map(({ tool: t, icon: Icon, label }) => (
            <Button key={t} type="button" variant={tool === t ? "default" : "outline"} size="sm" aria-pressed={tool === t}
              data-testid={`annotation-tool-${t}`} title={label} onClick={() => setTool(t)}>
              <Icon className="h-4 w-4" />
            </Button>
          ))}
          <span className="text-xs text-muted-foreground ml-2">{annotations.length} annotation{annotations.length === 1 ? "" : "s"}</span>
        </div>
      )}

      <div className="flex gap-2">
        <div
          ref={surfaceRef}
          className="relative flex-1 border border-border rounded overflow-hidden bg-muted/30 select-none"
          style={{ minHeight: 320, touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
          data-testid="annotation-surface"
          onPointerDown={onSurfacePointerDown}
          onPointerMove={onSurfacePointerMove}
          onPointerUp={onSurfacePointerUp}
        >
          {/* The deliverable media — a reference, never inlined. */}
          {deliverable.kind === "image" ? (
            <img src={deliverable.url} alt={deliverable.label ?? "deliverable"} className="block w-full h-auto pointer-events-none" data-testid="deliverable-image" draggable={false} />
          ) : (
            <object data={deliverable.url} type="application/pdf" className="block w-full pointer-events-none" style={{ height: 480 }} data-testid="deliverable-pdf" aria-label={deliverable.label ?? "deliverable PDF"}>
              <a href={deliverable.url} target="_blank" rel="noreferrer noopener" className="text-primary underline p-4 block pointer-events-auto">Open the PDF deliverable</a>
            </object>
          )}

          {/* The annotation markers, positioned by normalised coordinates. */}
          {annotations.map((a, i) => {
            const isSel = a.id === selectedId;
            const common = {
              key: a.id,
              "data-testid": `annotation-${a.id}`,
              onPointerDown: (e: React.PointerEvent) => onMarkerPointerDown(e, a.id),
              style: { position: "absolute" as const, left: pct(a.x), top: pct(a.y), cursor: readOnly ? "default" : "move" },
            };
            if (a.type === "pin") {
              return (
                <div {...common} className={`-translate-x-1/2 -translate-y-full ${a.resolved ? "opacity-50" : ""}`} title={a.text}>
                  <MapPin className={`h-6 w-6 drop-shadow ${isSel ? "text-primary" : "text-red-600"}`} fill={isSel ? "currentColor" : "#fca5a5"} />
                  <span className="absolute -top-1 -right-1 text-[9px] font-bold bg-foreground text-background rounded-full h-3.5 w-3.5 flex items-center justify-center">{i + 1}</span>
                </div>
              );
            }
            const region = { width: pct(a.w ?? 0), height: pct(a.h ?? 0) };
            const cls = a.type === "highlight"
              ? `bg-yellow-300/30 border-2 border-yellow-500 ${isSel ? "ring-2 ring-primary" : ""}`
              : `border-2 ${isSel ? "border-primary ring-2 ring-primary" : "border-red-600"} ${a.resolved ? "opacity-50" : ""}`;
            return <div {...common} className={cls} style={{ ...common.style, ...region }} title={a.text} />;
          })}
        </div>

        {/* Inspector for the selected annotation. */}
        {selected && !readOnly && (
          <aside className="w-56 shrink-0 border border-border rounded p-2 space-y-2" data-testid="annotation-inspector">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">{selected.type}</span>
              <button type="button" aria-label="Delete annotation" data-testid="annotation-delete" onClick={remove} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Input aria-label="Annotation note" data-testid="annotation-note" value={selected.text ?? ""} onChange={(e) => patch({ text: e.target.value })} className="h-8 text-sm" placeholder="Add a note…" />
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" data-testid="annotation-resolved" checked={selected.resolved ?? false} onChange={(e) => toggleResolved(e.target.checked)} />
              <Check className="h-3 w-3" /> Resolved
            </label>
          </aside>
        )}
      </div>
    </div>
  );
}
