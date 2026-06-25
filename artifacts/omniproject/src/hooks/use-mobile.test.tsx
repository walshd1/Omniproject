import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "./use-mobile";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Build a controllable matchMedia stub that records the change listener. */
function installMatchMedia(initialWidth: number) {
  let listener: (() => void) | null = null;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: initialWidth,
  });
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: () => void) => {
      listener = cb;
    },
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    fireChange(newWidth: number) {
      (window as unknown as { innerWidth: number }).innerWidth = newWidth;
      act(() => listener?.());
    },
  };
}

describe("useIsMobile", () => {
  it("returns true below the 768px breakpoint", () => {
    installMatchMedia(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false at/above the breakpoint", () => {
    installMatchMedia(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("reacts to viewport change events", () => {
    const mm = installMatchMedia(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    mm.fireChange(400);
    expect(result.current).toBe(true);

    mm.fireChange(900);
    expect(result.current).toBe(false);
  });

  it("treats exactly 768 as not mobile", () => {
    installMatchMedia(768);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });
});
