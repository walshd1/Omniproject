import { useRef, type TouchEvent as ReactTouchEvent } from "react";

/**
 * Touch swipe detection — a small, dependency-free gesture helper for the mobile/touch layout.
 *
 * Swipes are an ADDITIVE touch affordance: every action a swipe triggers also has a visible control
 * (a close button, a tab) and a keyboard path, so the both-ways rule still holds — touch users get a
 * natural shortcut on top, they never get the *only* way to do something. The classification is a
 * pure function so it can be reasoned about and unit-tested without a DOM.
 */

export interface Point { x: number; y: number; }
export type SwipeDirection = "left" | "right" | "up" | "down";

export interface SwipeOptions {
  /** Minimum primary-axis travel (px) for a swipe to count. Below this, it's a tap/jitter. */
  threshold?: number;
  /** Maximum off-axis travel (px) — keeps a clean horizontal/vertical swipe from a diagonal drag. */
  restraint?: number;
}

const DEFAULTS: Required<SwipeOptions> = { threshold: 50, restraint: 80 };

/**
 * Classify a drag from `start` to `end` into a cardinal swipe, or null if it doesn't qualify.
 * The dominant axis must travel at least `threshold`, and the other axis must stay within
 * `restraint`, so a lazy diagonal doesn't fire two directions or the wrong one.
 */
export function classifySwipe(start: Point, end: Point, options: SwipeOptions = {}): SwipeDirection | null {
  const { threshold, restraint } = { ...DEFAULTS, ...options };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX >= absY) {
    if (absX < threshold || absY > restraint) return null;
    return dx > 0 ? "right" : "left";
  }
  if (absY < threshold || absX > restraint) return null;
  return dy > 0 ? "down" : "up";
}

export type SwipeHandlers = Partial<Record<SwipeDirection, () => void>>;

export interface SwipeBindings {
  onTouchStart: (e: ReactTouchEvent) => void;
  onTouchEnd: (e: ReactTouchEvent) => void;
}

/**
 * Hook returning touch bindings to spread onto an element. On touch-end it classifies the gesture
 * and invokes the matching handler (if any). Multi-touch (e.g. a pinch) is ignored so it can't be
 * mistaken for a swipe.
 */
export function useSwipe(handlers: SwipeHandlers, options: SwipeOptions = {}): SwipeBindings {
  const start = useRef<Point | null>(null);
  return {
    onTouchStart: (e) => {
      if (e.touches.length !== 1) { start.current = null; return; }
      const t = e.touches[0]!;
      start.current = { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e) => {
      const from = start.current;
      start.current = null;
      if (!from) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dir = classifySwipe(from, { x: t.clientX, y: t.clientY }, options);
      if (dir) handlers[dir]?.();
    },
  };
}
