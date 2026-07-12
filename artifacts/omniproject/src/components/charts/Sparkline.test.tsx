import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a vector path and reports latest value + upward delta", () => {
    render(<Sparkline points={[10, 30, 55]} label="Completion" unit="%" />);
    expect(screen.getByTestId("sparkline")).toBeInTheDocument();
    expect(screen.getByText(/latest 55%/)).toBeInTheDocument();
    expect(screen.getByText(/▲ 45%/)).toBeInTheDocument();
    const path = screen.getByTestId("sparkline").querySelector("path")!;
    expect(path.getAttribute("d")).toMatch(/^M/); // starts with a move
  });

  it("marks a downward series with the ▼ marker", () => {
    render(<Sparkline points={[80, 40]} label="Burn" />);
    expect(screen.getByText(/▼ 40/)).toBeInTheDocument();
  });

  it("breaks the line across null gaps rather than drawing zero", () => {
    render(<Sparkline points={[10, null, 20]} label="Gappy" />);
    const d = screen.getByTestId("sparkline").querySelector("path")!.getAttribute("d")!;
    // Two segments ⇒ two move commands (before and after the gap).
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it("returns null when there are no numeric points", () => {
    const { container } = render(<Sparkline points={[null, null]} label="Empty" />);
    expect(container.firstChild).toBeNull();
  });

  it("honours a custom testId", () => {
    render(<Sparkline points={[1, 2]} label="X" testId="trend-chart" />);
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
  });
});
