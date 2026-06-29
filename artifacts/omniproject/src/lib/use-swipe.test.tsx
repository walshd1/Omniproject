import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { classifySwipe, useSwipe } from "./use-swipe";

/**
 * Touch swipe detection — pure classification + a hook that turns touch events into direction calls.
 */

describe("classifySwipe", () => {
  it("detects the four cardinal directions past the threshold", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 80, y: 0 })).toBe("right");
    expect(classifySwipe({ x: 80, y: 0 }, { x: 0, y: 0 })).toBe("left");
    expect(classifySwipe({ x: 0, y: 0 }, { x: 0, y: 80 })).toBe("down");
    expect(classifySwipe({ x: 0, y: 80 }, { x: 0, y: 0 })).toBe("up");
  });

  it("ignores travel below the threshold (a tap or jitter)", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 20, y: 0 })).toBeNull();
  });

  it("rejects a diagonal that breaks the off-axis restraint", () => {
    // Dominant axis is down (110px), but 100px of sideways drift exceeds the 80px restraint —
    // too messy to call a clean vertical swipe.
    expect(classifySwipe({ x: 0, y: 0 }, { x: 100, y: 110 })).toBeNull();
  });

  it("picks the dominant axis for a gentle diagonal", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 90, y: 30 })).toBe("right");
    expect(classifySwipe({ x: 0, y: 0 }, { x: 30, y: 90 })).toBe("down");
  });

  it("honours custom threshold/restraint options", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 30, y: 0 }, { threshold: 25 })).toBe("right");
    expect(classifySwipe({ x: 0, y: 0 }, { x: 80, y: 60 }, { restraint: 40 })).toBeNull();
  });
});

function Swiper({ onRight }: { onRight: () => void }) {
  const bind = useSwipe({ right: onRight });
  return <div data-testid="swiper" {...bind} style={{ width: 200, height: 200 }}>swipe me</div>;
}

const touch = (x: number, y: number) => ({ clientX: x, clientY: y });

describe("useSwipe", () => {
  it("fires the matching handler on a qualifying swipe", () => {
    const onRight = vi.fn();
    render(<Swiper onRight={onRight} />);
    const el = screen.getByTestId("swiper");
    fireEvent.touchStart(el, { touches: [touch(10, 10)] });
    fireEvent.touchEnd(el, { changedTouches: [touch(120, 15)] });
    expect(onRight).toHaveBeenCalledOnce();
  });

  it("does not fire when there is no qualifying swipe", () => {
    const onRight = vi.fn();
    render(<Swiper onRight={onRight} />);
    const el = screen.getByTestId("swiper");
    fireEvent.touchStart(el, { touches: [touch(10, 10)] });
    fireEvent.touchEnd(el, { changedTouches: [touch(20, 12)] }); // too short
    expect(onRight).not.toHaveBeenCalled();
  });

  it("ignores multi-touch (e.g. a pinch) so it can't be read as a swipe", () => {
    const onRight = vi.fn();
    render(<Swiper onRight={onRight} />);
    const el = screen.getByTestId("swiper");
    fireEvent.touchStart(el, { touches: [touch(10, 10), touch(50, 50)] });
    fireEvent.touchEnd(el, { changedTouches: [touch(120, 15)] });
    expect(onRight).not.toHaveBeenCalled();
  });
});
