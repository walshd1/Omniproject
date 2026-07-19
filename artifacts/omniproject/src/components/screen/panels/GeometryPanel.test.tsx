import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Panel } from "../../../lib/screen";
import { GeometryPanel } from "./GeometryPanel";

describe("GeometryPanel", () => {
  it("draws the config's geometry atoms on a canvas", () => {
    const panel: Panel = {
      id: "g",
      kind: "geometry",
      title: "Sketch",
      config: {
        width: 40,
        height: 20,
        shapes: [
          { type: "line", x1: 0, y1: 10, x2: 40, y2: 10 },
          { type: "point", x: 20, y: 10 },
        ],
      },
    };
    const { container } = render(<GeometryPanel panel={panel} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 40 20");
    expect(svg.querySelectorAll("line").length).toBe(1);
    expect(svg.querySelectorAll("circle").length).toBe(1);
    // The panel title becomes the canvas's accessible label.
    expect(svg.getAttribute("aria-label")).toBe("Sketch");
  });

  it("drops malformed shape entries and shows an empty state when nothing is drawable", () => {
    const panel: Panel = { id: "g2", kind: "geometry", config: { shapes: [null, 3, { noType: true }] } };
    render(<GeometryPanel panel={panel} />);
    expect(screen.getByText("Nothing to draw.")).toBeInTheDocument();
  });

  it("expands a declarative `grid` spec to line atoms, drawn under the explicit shapes", () => {
    const panel: Panel = {
      id: "g3",
      kind: "geometry",
      config: {
        width: 100,
        height: 100,
        grid: { rowGap: 50, colGap: 50 }, // 3 horizontals + 3 verticals = 6 gridlines
        shapes: [{ type: "point", x: 50, y: 50 }],
      },
    };
    const { container } = render(<GeometryPanel panel={panel} />);
    const svg = container.querySelector("svg")!;
    expect(svg.querySelectorAll("line").length).toBe(6);
    expect(svg.querySelectorAll("circle").length).toBe(1);
    // The grid is drawn first (beneath) so the explicit point sits on top. This panel isn't
    // interactive, so atoms render unwrapped.
    expect(svg.firstElementChild!.tagName.toLowerCase()).toBe("line");
    expect(svg.lastElementChild!.tagName.toLowerCase()).toBe("circle");
  });

  it("expands a declarative `chart` (column) into atom rects/lines/text", () => {
    const panel: Panel = {
      id: "g4",
      kind: "geometry",
      config: {
        width: 200,
        height: 100,
        chart: { type: "column", data: [{ label: "A", value: 10 }, { label: "B", value: 20 }] },
      },
    };
    const { container } = render(<GeometryPanel panel={panel} />);
    const svg = container.querySelector("svg")!;
    // Two positive bars → two rects; plus axis/gridlines and labels — all atoms, no <foreignObject>.
    expect(svg.querySelectorAll("rect").length).toBe(2);
    expect(svg.querySelectorAll("line").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll("text").length).toBeGreaterThan(0);
  });
});
