import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { isExplorationDirty, markExplorationClean } from "../../lib/exploration";
import { useScheduleShifts } from "./use-schedule-shifts";

vi.mock("../../lib/dependencies", () => ({ loadEdges: vi.fn(() => []) }));
import { loadEdges } from "../../lib/dependencies";

const ITEMS = [{ id: "a" }, { id: "b" }, { id: "c" }];

/** A fake pointer event carrying just what onPointerDown/Move/Up read. `trackWidth`
 *  models the drag track's `getBoundingClientRect().width`; `null` means no parent
 *  element (the detached-node edge case onPointerDown guards against). */
function pointerEvent(clientX: number, trackWidth: number | null): ReactPointerEvent {
  return {
    clientX,
    pointerId: 1,
    currentTarget: {
      parentElement: trackWidth === null ? null : { getBoundingClientRect: () => ({ width: trackWidth }) },
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
  } as unknown as ReactPointerEvent;
}

beforeEach(() => {
  vi.mocked(loadEdges).mockReturnValue([]);
});
afterEach(() => {
  markExplorationClean();
});

describe("useScheduleShifts", () => {
  describe("reset", () => {
    it("clears both shifts and edges", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.nudge("a", 2));
      act(() => {
        result.current.setPred("a");
        result.current.setSucc("b");
      });
      act(() => result.current.addEdge());
      expect(result.current.shifts).toEqual({ a: 2 });
      expect(result.current.edges).toHaveLength(1);

      act(() => result.current.reset());
      expect(result.current.shifts).toEqual({});
      expect(result.current.edges).toEqual([]);
    });
  });

  describe("addEdge", () => {
    it("does nothing when pred or succ is empty", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.setPred("a"));
      act(() => result.current.addEdge());
      expect(result.current.edges).toEqual([]);
    });

    it("does nothing when pred equals succ", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => {
        result.current.setPred("a");
        result.current.setSucc("a");
      });
      act(() => result.current.addEdge());
      expect(result.current.edges).toEqual([]);
    });

    it("does nothing when the exact edge already exists", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => {
        result.current.setPred("a");
        result.current.setSucc("b");
      });
      act(() => result.current.addEdge());
      act(() => {
        result.current.setPred("a");
        result.current.setSucc("b");
      });
      act(() => result.current.addEdge());
      expect(result.current.edges).toEqual([{ predecessorId: "a", successorId: "b" }]);
    });

    it("adds the edge, clears pred/succ, and marks exploration dirty", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => {
        result.current.setPred("a");
        result.current.setSucc("b");
      });
      expect(isExplorationDirty()).toBe(false);
      act(() => result.current.addEdge());
      expect(result.current.edges).toEqual([{ predecessorId: "a", successorId: "b" }]);
      expect(result.current.pred).toBe("");
      expect(result.current.succ).toBe("");
      expect(isExplorationDirty()).toBe(true);
    });
  });

  describe("importLinked", () => {
    it("imports a 'blocks' edge as from→to (from precedes to)", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "blocks", from: { itemRef: "a" }, to: { itemRef: "b" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([{ predecessorId: "a", successorId: "b" }]);
      expect(isExplorationDirty()).toBe(true);
    });

    it("imports a 'depends_on' edge as to→from (to precedes from)", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "depends_on", from: { itemRef: "a" }, to: { itemRef: "b" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([{ predecessorId: "b", successorId: "a" }]);
    });

    it("skips 'relates_to' edges entirely", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "relates_to", from: { itemRef: "a" }, to: { itemRef: "b" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([]);
      expect(isExplorationDirty()).toBe(false);
    });

    it("skips edges whose endpoints aren't among the current items", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "blocks", from: { itemRef: "a" }, to: { itemRef: "not-here" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([]);
    });

    it("skips a self-referencing edge (predecessor === successor)", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "blocks", from: { itemRef: "a" }, to: { itemRef: "a" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([]);
    });

    it("dedups against edges already present and leaves exploration clean when nothing new imports", () => {
      vi.mocked(loadEdges).mockReturnValue([
        { type: "blocks", from: { itemRef: "a" }, to: { itemRef: "b" } } as never,
      ]);
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.importLinked());
      markExplorationClean();

      act(() => result.current.importLinked());
      expect(result.current.edges).toEqual([{ predecessorId: "a", successorId: "b" }]);
      expect(isExplorationDirty()).toBe(false);
    });
  });

  describe("pointer drag", () => {
    it("onPointerDown is a no-op when the target has no parent track", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.onPointerDown(pointerEvent(0, null), "a"));
      act(() => result.current.onPointerMove(pointerEvent(50, 100)));
      expect(result.current.shifts).toEqual({});
    });

    it("shifts the day count proportionally to drag distance, marking dirty", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.onPointerDown(pointerEvent(0, 100), "a")); // pxPerDay = 100 / 10 = 10
      act(() => result.current.onPointerMove(pointerEvent(25, 100))); // +25px / 10 = +2.5 -> round 3? use exact multiple below
      expect(result.current.shifts.a).toBe(Math.round(25 / 10));
      expect(isExplorationDirty()).toBe(true);
    });

    it("onPointerMove is a no-op when no drag is in progress", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.onPointerMove(pointerEvent(50, 100)));
      expect(result.current.shifts).toEqual({});
      expect(isExplorationDirty()).toBe(false);
    });

    it("onPointerMove is a no-op when the track has zero width (pxPerDay <= 0)", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.onPointerDown(pointerEvent(0, 0), "a"));
      act(() => result.current.onPointerMove(pointerEvent(50, 0)));
      expect(result.current.shifts).toEqual({});
    });

    it("onPointerUp releases the pointer capture and clears the drag ref", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      const down = pointerEvent(0, 100);
      act(() => result.current.onPointerDown(down, "a"));
      const up = pointerEvent(0, 100);
      act(() => result.current.onPointerUp(up));
      expect(up.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);

      // A further move after pointer-up must not resume the (now-cleared) drag.
      act(() => result.current.onPointerMove(pointerEvent(50, 100)));
      expect(result.current.shifts).toEqual({});
    });

    it("onPointerUp is a no-op (doesn't throw, doesn't release capture) when no drag is in progress", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      const up = pointerEvent(0, 100);
      expect(() => act(() => result.current.onPointerUp(up))).not.toThrow();
      expect(up.currentTarget.releasePointerCapture).not.toHaveBeenCalled();
    });
  });

  describe("nudge", () => {
    it("adds whole days to an item's existing shift and marks exploration dirty", () => {
      const { result } = renderHook(() => useScheduleShifts({ items: ITEMS, getSpan: () => 10 }));
      act(() => result.current.nudge("a", 1));
      act(() => result.current.nudge("a", 2));
      expect(result.current.shifts.a).toBe(3);
      expect(isExplorationDirty()).toBe(true);
    });
  });
});
