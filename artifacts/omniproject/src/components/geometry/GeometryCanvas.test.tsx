import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { GeometryCanvas, type GeometryShape } from "./GeometryCanvas";

/**
 * The geometry atom renderer draws the four fundamentals (line/rect/text/point) straight from their
 * JSON params, with the catalogue's documented defaults, tolerant of stringly-typed values, and
 * fail-soft on an unknown type. These tests pin that contract — it's the base every drawable recipe
 * composes onto.
 */
function draw(shapes: GeometryShape[], props?: { title?: string; width?: number; height?: number }) {
  return render(<GeometryCanvas shapes={shapes} {...props} />).container.querySelector("svg")!;
}

describe("GeometryCanvas", () => {
  it("draws a line atom with its endpoints, stroke and thickness", () => {
    const svg = draw([{ type: "line", x1: 0, y1: 5, x2: 10, y2: 5, stroke: "#ff0000", thickness: 2 }]);
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("x1")).toBe("0");
    expect(line.getAttribute("y1")).toBe("5");
    expect(line.getAttribute("x2")).toBe("10");
    expect(line.getAttribute("stroke")).toBe("#ff0000");
    expect(line.getAttribute("stroke-width")).toBe("2");
  });

  it("applies the documented defaults when style params are absent (thickness 1, foreground stroke)", () => {
    const svg = draw([{ type: "line", x1: 0, y1: 0, x2: 1, y2: 1 }]);
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("stroke-width")).toBe("1");
    expect(line.getAttribute("stroke")).toBe("currentColor");
    // No dash unless asked for.
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("draws a dashed line only when a dash pattern is given", () => {
    const svg = draw([{ type: "line", x1: 0, y1: 0, x2: 10, y2: 0, dash: "4 4" }]);
    expect(svg.querySelector("line")!.getAttribute("stroke-dasharray")).toBe("4 4");
  });

  it("draws a rect with origin+size, a rounded corner, and no fill by default", () => {
    const svg = draw([{ type: "rect", x: 2, y: 3, width: 20, height: 8, fill: "#00ff00", radius: 2 }]);
    const rect = svg.querySelector("rect")!;
    expect(rect.getAttribute("x")).toBe("2");
    expect(rect.getAttribute("width")).toBe("20");
    expect(rect.getAttribute("height")).toBe("8");
    expect(rect.getAttribute("fill")).toBe("#00ff00");
    expect(rect.getAttribute("rx")).toBe("2");
    // A fill-less rect renders fill="none" rather than a solid block.
    expect(draw([{ type: "rect", x: 0, y: 0, width: 4, height: 4 }]).querySelector("rect")!.getAttribute("fill")).toBe("none");
  });

  it("draws a text atom with its content, size, weight and anchor", () => {
    const svg = draw([{ type: "text", x: 5, y: 6, content: "Hi", size: 14, weight: "bold", anchor: "middle" }]);
    const text = svg.querySelector("text")!;
    expect(text.textContent).toBe("Hi");
    expect(text.getAttribute("font-size")).toBe("14");
    expect(text.getAttribute("font-weight")).toBe("bold");
    expect(text.getAttribute("text-anchor")).toBe("middle");
  });

  it("draws a point atom as a circle with its radius default", () => {
    const svg = draw([{ type: "point", x: 7, y: 8 }]);
    const c = svg.querySelector("circle")!;
    expect(c.getAttribute("cx")).toBe("7");
    expect(c.getAttribute("cy")).toBe("8");
    expect(c.getAttribute("r")).toBe("2");
  });

  it("tolerates stringly-typed JSON params (coerces numbers)", () => {
    const svg = draw([{ type: "line", x1: "0", y1: "0", x2: "12", y2: "0", thickness: "3" } as unknown as GeometryShape]);
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("x2")).toBe("12");
    expect(line.getAttribute("stroke-width")).toBe("3");
  });

  it("skips an unknown atom type rather than throwing (fail-soft)", () => {
    const svg = draw([{ type: "hexagon", x: 0, y: 0 } as unknown as GeometryShape, { type: "point", x: 1, y: 1 }]);
    expect(svg.querySelectorAll("circle").length).toBe(1);
    expect(svg.querySelector('[class]')).not.toBeTruthy(); // nothing exotic rendered
  });

  it("is decorative (aria-hidden) without a title, and a labelled image with one", () => {
    const bare = draw([{ type: "point", x: 0, y: 0 }]);
    expect(bare.getAttribute("aria-hidden")).toBe("true");
    expect(bare.getAttribute("role")).toBeNull();

    const labelled = draw([{ type: "point", x: 0, y: 0 }], { title: "A dot" });
    expect(labelled.getAttribute("role")).toBe("img");
    expect(labelled.getAttribute("aria-label")).toBe("A dot");
    expect(labelled.querySelector("title")!.textContent).toBe("A dot");
  });

  it("sets the coordinate viewport from width/height", () => {
    const svg = draw([], { width: 200, height: 40 });
    expect(svg.getAttribute("viewBox")).toBe("0 0 200 40");
  });
});
