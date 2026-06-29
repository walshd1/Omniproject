import { describe, it, expect } from "vitest";
import { dayShiftFromDrag } from "./drag-schedule";

describe("dayShiftFromDrag", () => {
  it("returns the original shift when the pointer hasn't moved", () => {
    expect(dayShiftFromDrag(100, 100, 10, 0)).toBe(0);
    expect(dayShiftFromDrag(100, 100, 10, 3)).toBe(3);
  });

  it("adds whole days based on px-per-day scale", () => {
    expect(dayShiftFromDrag(0, 30, 10, 0)).toBe(3);
    expect(dayShiftFromDrag(0, 30, 10, 2)).toBe(5);
  });

  it("rounds to the nearest day", () => {
    expect(dayShiftFromDrag(0, 14, 10, 0)).toBe(1);
    expect(dayShiftFromDrag(0, 16, 10, 0)).toBe(2);
  });

  it("handles dragging left (negative delta)", () => {
    expect(dayShiftFromDrag(50, 20, 10, 0)).toBe(-3);
    expect(dayShiftFromDrag(50, 20, 10, 5)).toBe(2);
  });
});
