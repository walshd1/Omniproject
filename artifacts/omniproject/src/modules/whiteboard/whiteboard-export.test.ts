import { describe, it, expect } from "vitest";
import type { CanvasElement } from "@workspace/backend-catalogue";
import { sceneBounds, toExportSvg, exportFileStem } from "./whiteboard-export";

/** Whiteboard export: pure scene-bounds maths + standalone-SVG serialisation (client-side, no upload). */

const SVG_NS = "http://www.w3.org/2000/svg";

describe("sceneBounds", () => {
  it("returns a sensible default for an empty scene", () => {
    expect(sceneBounds([])).toEqual({ x: 0, y: 0, w: 640, h: 480 });
  });

  it("wraps every element with padding", () => {
    const els: CanvasElement[] = [
      { id: "a", type: "sticky", x: 100, y: 100, w: 160, h: 120 },
      { id: "b", type: "shape", x: 400, y: 50, w: 80, h: 80, shape: "ellipse" },
    ];
    // union = x:100..480, y:50..220 → with pad 24: x 76, y 26, w 404+48=428? (380 + 48), h 170+48
    const box = sceneBounds(els, 24);
    expect(box.x).toBe(76);
    expect(box.y).toBe(26);
    expect(box.w).toBe(380 + 48); // (480-100) + 2*24
    expect(box.h).toBe(170 + 48); // (220-50) + 2*24
  });
});

describe("toExportSvg", () => {
  it("produces a standalone svg cropped to the scene, with a white backing rect", () => {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const child = document.createElementNS(SVG_NS, "rect");
    child.setAttribute("data-el", "a");
    svg.appendChild(child);

    const els: CanvasElement[] = [{ id: "a", type: "sticky", x: 10, y: 20, w: 100, h: 60 }];
    const out = toExportSvg(svg, els);
    const box = sceneBounds(els);

    expect(out).toContain(`viewBox="${box.x} ${box.y} ${box.w} ${box.h}"`);
    expect(out).toContain(`width="${Math.round(box.w)}"`);
    expect(out).toContain(`xmlns="http://www.w3.org/2000/svg"`);
    expect(out).toContain(`fill="#ffffff"`); // the backing rect
    expect(out).toContain(`data-el="a"`); // the original content is preserved
    // The source element is NOT mutated (a clone was serialised).
    expect(svg.getAttribute("viewBox")).toBe(null);
  });
});

describe("exportFileStem", () => {
  it("slugifies a board name into a safe filename stem", () => {
    expect(exportFileStem("Delivery Roadmap!")).toBe("delivery-roadmap");
    expect(exportFileStem("  ")).toBe("whiteboard");
    expect(exportFileStem("A/B — test")).toBe("a-b-test");
  });
});
