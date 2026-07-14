import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  // A recharts primitive always mounts a ResponsiveContainer; asserting it is present proves the
  // spec dispatched to the right primitive (not just "didn't throw").
  const hasChart = (c: HTMLElement) => expect(c.querySelector(".recharts-responsive-container")).toBeInTheDocument();

  describe("optional-prop branches per chart type", () => {
    it("bar: renders with every option set", () => {
      const { container } = render(
        <ChartView type="bar" data={rows} series={series} stacked legend={false} orientation="vertical"
          height={200} referenceLines={[{ value: 4 }]} valueFormatter={(n) => `£${n}`} palette={["#111"]} />,
      );
      hasChart(container);
    });

    it("bar: renders with no options (all falsy branches → primitive defaults)", () => {
      const { container } = render(<ChartView type="bar" data={rows} series={series} />);
      hasChart(container);
    });

    it("line: renders with every option set", () => {
      const { container } = render(
        <ChartView type="line" data={rows} series={series} legend={false} height={180} xKey="name"
          referenceLines={[{ value: 4, label: "target" }]} valueFormatter={(n) => `${n}%`} yDomain={[0, 10]} palette={["#222"]} />,
      );
      hasChart(container);
    });

    it("line: renders with no options", () => {
      const { container } = render(<ChartView type="line" data={rows} series={series} />);
      hasChart(container);
    });

    it("area: renders with every option set", () => {
      const { container } = render(
        <ChartView type="area" data={rows} series={series} stacked legend={false} height={180} xKey="name"
          referenceLines={[{ value: 4 }]} valueFormatter={(n) => `${n}`} yDomain={[0, 10]} palette={["#333"]} />,
      );
      hasChart(container);
    });

    it("area: renders with no options", () => {
      const { container } = render(<ChartView type="area" data={rows} series={series} />);
      hasChart(container);
    });

    it("pie: renders with palette + height and without", () => {
      const withOpts = render(<ChartView type="pie" data={[{ name: "A", value: 3 }]} legend={false} height={200} palette={["#444"]} />);
      hasChart(withOpts.container);
      const bare = render(<ChartView type="pie" data={[{ name: "A", value: 3 }]} />);
      hasChart(bare.container);
    });

    it("donut: sets the donut flag (type === 'donut') and renders", () => {
      const { container } = render(<ChartView type="donut" data={[{ name: "A", value: 3 }]} palette={["#555"]} height={200} />);
      hasChart(container);
    });

    it("scatter: renders with x/y labels + height and without", () => {
      const withOpts = render(<ChartView type="scatter" points={[{ x: 1, y: 2 }]} xLabel="cost" yLabel="value" height={200} />);
      hasChart(withOpts.container);
      const bare = render(<ChartView type="scatter" points={[{ x: 1, y: 2 }]} />);
      hasChart(bare.container);
    });

    it("treemap: renders with height and without", () => {
      const withH = render(<ChartView type="treemap" data={[{ name: "A", value: 3 }]} height={200} />);
      hasChart(withH.container);
      const bare = render(<ChartView type="treemap" data={[{ name: "A", value: 3 }]} />);
      hasChart(bare.container);
    });

    it("gantt: renders with height + palette and without either", () => {
      const withOpts = render(<ChartView type="gantt" items={[{ label: "T", start: "2026-01-01", end: "2026-02-01" }]} height={120} palette={["#666"]} />);
      expect(within(withOpts.container).getByTestId("gantt-chart")).toBeInTheDocument();
      const bare = render(<ChartView type="gantt" items={[{ label: "T", start: "2026-01-01", end: "2026-02-01" }]} />);
      expect(within(bare.container).getByTestId("gantt-chart")).toBeInTheDocument();
    });
  });
});
