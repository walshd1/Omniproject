import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVirtualRows } from "./use-virtual-rows";

/** A minimal fake scroll container the hook measures + listens on. */
function fakeContainer(over: { clientHeight?: number; rowHeight?: number } = {}) {
  const listeners: Record<string, () => void> = {};
  const el = {
    clientHeight: over.clientHeight ?? 0,
    scrollTop: 0,
    querySelector: () => (over.rowHeight ? { offsetHeight: over.rowHeight } : null),
    addEventListener: (e: string, cb: () => void) => { listeners[e] = cb; },
    removeEventListener: () => {},
  };
  return { ref: { current: el as unknown as HTMLElement }, el, fire: (e: string) => listeners[e]?.() };
}

describe("useVirtualRows", () => {
  it("renders every row for a short list (≤ min) — no windowing", () => {
    const { ref } = fakeContainer({ clientHeight: 400, rowHeight: 40 });
    const { result } = renderHook(() => useVirtualRows(ref, 30, { min: 60 }));
    expect(result.current).toEqual({ start: 0, end: 30, padTop: 0, padBottom: 0 });
  });

  it("renders every row when the container is unmeasured (jsdom/SSR)", () => {
    const { ref } = fakeContainer({ clientHeight: 0 }); // clientHeight 0 = not laid out
    const { result } = renderHook(() => useVirtualRows(ref, 5000, { min: 60 }));
    expect(result.current.start).toBe(0);
    expect(result.current.end).toBe(5000);
  });

  it("windows a long list to the visible slice + overscan, with honest spacer totals", () => {
    const { ref } = fakeContainer({ clientHeight: 400, rowHeight: 40 });
    const { result } = renderHook(() => useVirtualRows(ref, 1000, { min: 60, overscan: 5 }));
    // visible = ceil(400/40) + 5*2 = 10 + 10 = 20; start = 0.
    expect(result.current.start).toBe(0);
    expect(result.current.end).toBe(20);
    expect(result.current.padTop).toBe(0);
    expect(result.current.padBottom).toBe((1000 - 20) * 40);
  });

  it("advances the window on scroll and keeps padTop+rendered+padBottom == total height", () => {
    const c = fakeContainer({ clientHeight: 400, rowHeight: 40 });
    const { result } = renderHook(() => useVirtualRows(c.ref, 1000, { min: 60, overscan: 5 }));
    act(() => { c.el.scrollTop = 4000; c.fire("scroll"); });
    // start = floor(4000/40) - 5 = 100 - 5 = 95; end = 95 + 20 = 115.
    expect(result.current.start).toBe(95);
    expect(result.current.end).toBe(115);
    const rendered = result.current.end - result.current.start;
    expect(result.current.padTop + rendered * 40 + result.current.padBottom).toBe(1000 * 40);
  });
});
