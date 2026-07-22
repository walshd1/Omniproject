import { describe, it, expect } from "vitest";
import { clamp01, toNorm, placeAnnotation, moveAnnotation, DEFAULT_REGION } from "./proof-geometry";

/** Pure geometry for the proof annotation overlay — normalised coords, placement + move, all in [0,1]. */

const RECT = { left: 100, top: 50, width: 400, height: 200 };

describe("proof-geometry", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });

  it("maps a client point into the rect's [0,1] space (and clamps outside it)", () => {
    expect(toNorm(300, 150, RECT)).toEqual({ x: 0.5, y: 0.5 }); // centre
    expect(toNorm(100, 50, RECT)).toEqual({ x: 0, y: 0 });      // top-left
    expect(toNorm(1000, 1000, RECT)).toEqual({ x: 1, y: 1 });   // beyond → clamped
  });

  it("a zero-size rect degrades safely to the origin", () => {
    expect(toNorm(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("places a pin AT the point (no region)", () => {
    const pin = placeAnnotation("pin", { x: 0.3, y: 0.7 }, "a1");
    expect(pin).toMatchObject({ id: "a1", type: "pin", x: 0.3, y: 0.7 });
    expect("w" in pin).toBe(false);
  });

  it("places a region with a default size, clamped to stay in-bounds", () => {
    const box = placeAnnotation("box", { x: 0.95, y: 0.95 }, "b1");
    expect(box.w).toBe(DEFAULT_REGION.w);
    expect(box.h).toBe(DEFAULT_REGION.h);
    expect(box.x).toBeCloseTo(1 - DEFAULT_REGION.w); // anchored so the box fits
    expect(box.y).toBeCloseTo(1 - DEFAULT_REGION.h);
  });

  it("moves an annotation to a new anchor, keeping its region in-bounds", () => {
    const box = placeAnnotation("highlight", { x: 0.1, y: 0.1 }, "h1");
    const moved = moveAnnotation(box, { x: 0.99, y: 0.5 });
    expect(moved.x).toBeCloseTo(1 - (box.w ?? 0));
    expect(moved.y).toBe(0.5);
  });
});
