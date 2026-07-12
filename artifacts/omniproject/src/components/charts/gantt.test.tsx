import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GanttChart, type GanttItem } from "./gantt";

const items: GanttItem[] = [
  { label: "Design", start: "2026-01-01", end: "2026-01-31", progress: 50 },
  { label: "Build", start: "2026-02-01", end: "2026-03-15" },
  { label: "No dates", start: "nope", end: "also-nope" },
];

describe("GanttChart", () => {
  it("places a positioned bar per dated item with a start–end aria-label", () => {
    render(<GanttChart items={items} />);
    expect(screen.getByTestId("gantt-chart")).toBeInTheDocument();
    // Undated rows are dropped; the two dated items each get a labelled bar.
    expect(screen.getByLabelText("Design: 2026-01-01 to 2026-01-31")).toBeInTheDocument();
    expect(screen.getByLabelText("Build: 2026-02-01 to 2026-03-15")).toBeInTheDocument();
    expect(screen.queryByLabelText(/No dates/)).not.toBeInTheDocument();
  });

  it("positions the first bar at the domain start (left 0%)", () => {
    render(<GanttChart items={items} />);
    const design = screen.getByLabelText("Design: 2026-01-01 to 2026-01-31");
    expect(design.style.left).toBe("0%");
    expect(parseFloat(design.style.width)).toBeGreaterThan(0);
  });

  it("shows an empty state when no item has usable dates", () => {
    render(<GanttChart items={[{ label: "x", start: "bad", end: "bad" }]} />);
    expect(screen.getByTestId("gantt-empty")).toBeInTheDocument();
  });
});
