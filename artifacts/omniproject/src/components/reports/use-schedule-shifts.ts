import { useRef, useState } from "react";
import type { DepEdge } from "../../lib/schedule-scenario";
import { loadEdges } from "../../lib/dependencies";
import { markExplorationDirty } from "../../lib/exploration";
import { dayShiftFromDrag } from "../../lib/drag-schedule";

interface ScheduleItemRef {
  id: string;
}

interface UseScheduleShiftsArgs {
  /** The schedule items in play (used to gate the dependency import/editor). */
  items: ScheduleItemRef[];
  /**
   * Current timeline span in days — the px-per-day scale denominator. Passed as
   * a getter because the span is derived from the very shifts this hook owns, so
   * it must be read lazily (at drag time) rather than captured at hook init.
   */
  getSpan: () => number;
}

/**
 * Volatile scenario state for the schedule sandbox: per-item day shifts, the
 * ad-hoc dependency edges, the dependency editor's draft selection, and the
 * pointer-drag gesture that turns a bar drag into a whole-day shift. Every
 * mutation marks the exploration dirty, matching the inline original.
 */
export function useScheduleShifts({ items, getSpan }: UseScheduleShiftsArgs) {
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [edges, setEdges] = useState<DepEdge[]>([]);
  const [pred, setPred] = useState("");
  const [succ, setSucc] = useState("");
  const dragRef = useRef<{ id: string; startX: number; origShift: number; pxPerDay: number } | null>(null);

  const touch = () => markExplorationDirty();
  const reset = () => {
    setShifts({});
    setEdges([]);
  };

  const addEdge = () => {
    if (!pred || !succ || pred === succ) return;
    if (edges.some((e) => e.predecessorId === pred && e.successorId === succ)) return;
    setEdges((e) => [...e, { predecessorId: pred, successorId: succ }]);
    setPred("");
    setSucc("");
    touch();
  };

  // Best-effort reuse of dependency links you already asserted in /explore:
  // import any depends_on / blocks edge whose endpoints resolve to issues here.
  const importLinked = () => {
    const ids = new Set(items.map((i) => i.id));
    const imported: DepEdge[] = [];
    for (const e of loadEdges()) {
      if (e.type === "relates_to") continue;
      // "blocks": from → to (from precedes to). "depends_on": to → from.
      const [p, s] = e.type === "blocks" ? [e.from.itemRef, e.to.itemRef] : [e.to.itemRef, e.from.itemRef];
      if (ids.has(p) && ids.has(s) && p !== s) imported.push({ predecessorId: p, successorId: s });
    }
    if (imported.length) {
      setEdges((cur) => {
        const seen = new Set(cur.map((x) => `${x.predecessorId}>${x.successorId}`));
        return [...cur, ...imported.filter((x) => !seen.has(`${x.predecessorId}>${x.successorId}`))];
      });
      touch();
    }
  };

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    const track = e.currentTarget.parentElement;
    if (!track) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id,
      startX: e.clientX,
      origShift: shifts[id] ?? 0,
      pxPerDay: track.getBoundingClientRect().width / getSpan(),
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pxPerDay <= 0) return;
    const next = dayShiftFromDrag(d.startX, e.clientX, d.pxPerDay, d.origShift);
    setShifts((prev) => ({ ...prev, [d.id]: next }));
    touch();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current) e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };
  const nudge = (id: string, days: number) => {
    setShifts((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + days }));
    touch();
  };

  return {
    shifts,
    edges,
    setEdges,
    pred,
    setPred,
    succ,
    setSucc,
    touch,
    reset,
    addEdge,
    importLinked,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    nudge,
  };
}
