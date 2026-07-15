import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Hand-rolled, dependency-free row virtualization for a single scroll container — so a list of 10k
 * rows renders only the ~visible slice instead of 10k DOM nodes (the client-side analogue of the
 * server's "don't materialise the whole portfolio" rule).
 *
 * Deliberately conservative:
 *  - Falls back to rendering EVERY row when the container height can't be measured (jsdom / SSR) or
 *    the list is short (≤ `min`), so tests and small lists behave EXACTLY as before — no windowing.
 *  - Measures the real height of a rendered row (`[data-vrow]`) rather than trusting the estimate, so
 *    the spacer totals stay honest and the scrollbar doesn't drift.
 *  - Only updates when the visible window actually changes, so scrolling within a window is free.
 */
export interface VirtualWindow {
  /** First visible row index (inclusive). */
  start: number;
  /** One past the last visible row index (exclusive). */
  end: number;
  /** Spacer height above the rendered slice (px). */
  padTop: number;
  /** Spacer height below the rendered slice (px). */
  padBottom: number;
}

export function useVirtualRows(
  containerRef: RefObject<HTMLElement | null>,
  count: number,
  opts: { estimate?: number; overscan?: number; min?: number } = {},
): VirtualWindow {
  const estimate = opts.estimate ?? 36;
  const overscan = opts.overscan ?? 10;
  const min = opts.min ?? 60;
  const rowH = useRef(estimate);
  const [win, setWin] = useState<VirtualWindow>({ start: 0, end: count, padTop: 0, padBottom: 0 });

  useEffect(() => {
    const el = containerRef.current;
    // Unmeasured (jsdom/SSR) or a short list → render everything (behaviour unchanged).
    if (!el || count <= min) {
      setWin((prev) => (prev.start === 0 && prev.end === count ? prev : { start: 0, end: count, padTop: 0, padBottom: 0 }));
      return;
    }
    const recompute = () => {
      const h = el.clientHeight;
      if (!h) {
        setWin((prev) => (prev.start === 0 && prev.end === count ? prev : { start: 0, end: count, padTop: 0, padBottom: 0 }));
        return;
      }
      // Measure a real data row once one exists — keeps the spacer totals honest.
      const sample = el.querySelector<HTMLElement>("[data-vrow]");
      if (sample && sample.offsetHeight) rowH.current = sample.offsetHeight;
      const rh = rowH.current;
      const start = Math.max(0, Math.floor(el.scrollTop / rh) - overscan);
      const end = Math.min(count, start + Math.ceil(h / rh) + overscan * 2);
      setWin((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end, padTop: start * rh, padBottom: (count - end) * rh },
      );
    };
    recompute();
    el.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      el.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [containerRef, count, overscan, min]);

  return win;
}
