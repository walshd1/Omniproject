import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InteractiveGeometryCanvas } from "./InteractiveGeometryCanvas";
import { buildColumnChart } from "../../lib/geometry/charts";
import type { GeometryShape } from "./GeometryCanvas";

/**
 * The interactive atom canvas gives a chart hover/focus tooltips with NO charting library — proving
 * the "rebuild interactivity from atoms" path. A shape's `hover` string becomes a focusable region
 * that reveals a tooltip and is announced to assistive tech.
 */
describe("InteractiveGeometryCanvas", () => {
  const shapes: GeometryShape[] = [
    { type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#2563eb", hover: "A: 10" },
    { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 }, // no hover → not interactive
  ];

  it("reveals a tooltip on hover and clears it on leave", () => {
    render(<InteractiveGeometryCanvas shapes={shapes} width={20} height={20} />);
    const region = screen.getByLabelText("A: 10");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(region);
    expect(screen.getByRole("tooltip")).toHaveTextContent("A: 10");
    fireEvent.mouseLeave(region);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reveals the tooltip on keyboard focus too (accessible), and announces the label", () => {
    render(<InteractiveGeometryCanvas shapes={shapes} width={20} height={20} />);
    const region = screen.getByLabelText("A: 10");
    // Focusable region carrying an accessible name.
    expect(region).toHaveAttribute("tabindex", "0");
    fireEvent.focus(region);
    expect(screen.getByRole("tooltip")).toHaveTextContent("A: 10");
    fireEvent.blur(region);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("only wraps shapes that carry hover data (others stay plain)", () => {
    const { container } = render(<InteractiveGeometryCanvas shapes={shapes} width={20} height={20} />);
    // Exactly one focusable region (the rect); the line is not interactive.
    expect(container.querySelectorAll("g[tabindex]").length).toBe(1);
  });

  it("makes an atom-composed bar chart interactive: each bar is a labelled, focusable region", () => {
    render(
      <InteractiveGeometryCanvas
        shapes={buildColumnChart({ data: [{ label: "A", value: 10 }, { label: "B", value: 20 }], width: 200, height: 100 })}
        width={200}
        height={100}
      />,
    );
    // Both bars are hoverable with their data label.
    expect(screen.getByLabelText("A: 10")).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByLabelText("B: 20"));
    expect(screen.getByRole("tooltip")).toHaveTextContent("B: 20");
  });
});
