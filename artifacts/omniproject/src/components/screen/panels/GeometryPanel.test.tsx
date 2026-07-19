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
});
