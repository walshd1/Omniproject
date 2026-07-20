import { describe, it, expect } from "vitest";
import type { CanvasElement } from "@workspace/backend-catalogue";
import {
  stickyHex, STICKY_HEX, seedFromId, elementBounds, strokeToPath,
  newElement, moveElement, updateElement, removeElement,
} from "./canvas-geometry";

/** Pure canvas geometry + reducers — the whiteboard editor's testable core. */

describe("colours + seed", () => {
  it("maps named sticky colours and defaults unknown to yellow", () => {
    expect(stickyHex("green")).toBe(STICKY_HEX.green);
    expect(stickyHex(undefined)).toBe(STICKY_HEX.yellow);
    expect(stickyHex("chartreuse")).toBe(STICKY_HEX.yellow);
  });
  it("seedFromId is deterministic and positive", () => {
    expect(seedFromId("el-1")).toBe(seedFromId("el-1"));
    expect(seedFromId("el-1")).not.toBe(seedFromId("el-2"));
    expect(seedFromId("anything")).toBeGreaterThan(0);
  });
});

describe("elementBounds", () => {
  it("boxes a sticky by w/h", () => {
    expect(elementBounds({ id: "a", type: "sticky", x: 10, y: 20, w: 100, h: 50 })).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });
  it("normalises a connector's bounds regardless of direction", () => {
    expect(elementBounds({ id: "c", type: "connector", x: 100, y: 100, x2: 40, y2: 60 })).toEqual({ x: 40, y: 60, w: 60, h: 40 });
  });
  it("bounds a freehand stroke by its points (offset by origin)", () => {
    const b = elementBounds({ id: "d", type: "draw", x: 5, y: 5, points: [[0, 0], [10, 20]] });
    expect(b).toEqual({ x: 5, y: 5, w: 10, h: 20 });
  });
});

describe("strokeToPath", () => {
  it("produces a non-empty SVG path for a stroke", () => {
    const d = strokeToPath([[0, 0], [10, 10], [20, 5]], 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.length).toBeGreaterThan(3);
  });
  it("is empty for no points", () => {
    expect(strokeToPath([], 4)).toBe("");
  });
});

describe("element factory + reducers", () => {
  it("newElement gives sensible per-type defaults", () => {
    expect(newElement("sticky", 1, 2, "s")).toMatchObject({ type: "sticky", x: 1, y: 2, color: "yellow", w: 160 });
    expect(newElement("shape", 0, 0, "sh")).toMatchObject({ type: "shape", shape: "rectangle" });
    expect(newElement("connector", 0, 0, "c")).toMatchObject({ type: "connector", x2: 120, y2: 0 });
  });

  it("moveElement shifts x/y and a connector's far end", () => {
    const els: CanvasElement[] = [
      { id: "s", type: "sticky", x: 10, y: 10 },
      { id: "c", type: "connector", x: 0, y: 0, x2: 50, y2: 50 },
    ];
    expect(moveElement(els, "s", 5, -3).find((e) => e.id === "s")).toMatchObject({ x: 15, y: 7 });
    const c = moveElement(els, "c", 10, 10).find((e) => e.id === "c")!;
    expect(c).toMatchObject({ x: 10, y: 10, x2: 60, y2: 60 });
  });

  it("updateElement patches and removeElement drops, immutably", () => {
    const els: CanvasElement[] = [{ id: "a", type: "sticky", x: 0, y: 0, text: "hi" }];
    expect(updateElement(els, "a", { text: "bye" })[0]!.text).toBe("bye");
    expect(els[0]!.text).toBe("hi"); // original untouched
    expect(removeElement(els, "a")).toEqual([]);
  });
});
