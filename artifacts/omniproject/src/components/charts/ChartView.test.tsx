import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartView } from "./ChartView";

/**
 * ChartView is the one common chart renderer — every chart type dispatches to a primitive from a
 * plain spec. jsdom gives Recharts no width, so we assert construction (no throw) across every type,
 * plus the gantt path which is div-based and DOM-assertable.
 */
const rows = [{ name: "A", v: 3 }, { name: "B", v: 5 }];
const series = [{ key: "v", label: "V" }];

describe("ChartView", () => {
  it("renders every chart type from a spec without throwing", () => {
    expect(() => render(<ChartView type="bar" data={rows} series={series} referenceLines={[{ value: 4 }]} />)).not.toThrow();
    expect(() => render(<ChartView type="line" data={rows} series={series} xKey="name" referenceLines={[{ value: 4, label: "target" }]} />)).not.toThrow();
    expect(() => render(<ChartView type="area" data={rows} series={series} stacked />)).not.toThrow();
    expect(() => render(<ChartView type="pie" data={[{ name: "A", value: 3 }]} />)).not.toThrow();
    expect(() => render(<ChartView type="donut" data={[{ name: "A", value: 3 }]} />)).not.toThrow();
    expect(() => render(<ChartView type="scatter" points={[{ x: 1, y: 2 }]} />)).not.toThrow();
    expect(() => render(<ChartView type="treemap" data={[{ name: "A", value: 3 }]} />)).not.toThrow();
  });

  it("renders the div-based gantt path from a spec", () => {
    render(<ChartView type="gantt" items={[{ label: "Task", start: "2026-01-01", end: "2026-02-01" }]} />);
    expect(screen.getByTestId("gantt-chart")).toBeInTheDocument();
    expect(screen.getByLabelText("Task: 2026-01-01 to 2026-02-01")).toBeInTheDocument();
  });

  it("accepts a percentage height (cards that own their height)", () => {
    expect(() => render(<ChartView type="line" data={rows} series={series} height="100%" />)).not.toThrow();
  });

  it("wraps the chart in a styled frame when a style spec is given", () => {
    render(
      <ChartView
        type="gantt"
        items={[{ label: "Task", start: "2026-01-01", end: "2026-02-01" }]}
        style={{ title: "Delivery plan", background: "#f5f5f5" }}
      />,
    );
    // The chart still draws…
    expect(screen.getByTestId("gantt-chart")).toBeInTheDocument();
    // …now inside a frame carrying the user's title.
    expect(screen.getByText("Delivery plan")).toBeInTheDocument();
  });

  it("does not add a frame when no style is given", () => {
    render(<ChartView type="gantt" items={[{ label: "Task", start: "2026-01-01", end: "2026-02-01" }]} />);
    expect(screen.getByTestId("gantt-chart").closest("figure")).toBeNull();
  });
});
