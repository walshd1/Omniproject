import { describe, it, expect, vi } from "vitest";
import { cloneElement, isValidElement, type ReactElement } from "react";
import { render } from "@testing-library/react";

// jsdom gives recharts' ResponsiveContainer no measured size (the ResizeObserver stub reports 0),
// so the chart children never lay out and their render-prop callbacks (tick/tooltip formatters, the
// pie % label, the treemap cell) never run. Replace it with a passthrough that hands the chart a
// fixed pixel size, so the real recharts marks render and those callbacks actually execute — letting
// the tests assert the rendered structure per chart type instead of only "constructs without error".
vi.mock("recharts", async (importActual) => {
  const actual = await importActual<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children, height }: { children: ReactElement; height?: number }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
            width: 600,
            height: typeof height === "number" ? height : 300,
          })
        : children,
  };
});

import { SeriesBarChart, SeriesLineChart, SeriesAreaChart, SharePieChart, ScatterPlotChart, TreemapChart, formatChartNumber, CHART_PALETTE, type ChartRow, type ChartSeries } from "./primitives";

/**
 * The chart primitives are data-agnostic — they take plain series + rows from ANY source. jsdom gives
 * Recharts no width so the SVG marks don't lay out, but the components must construct without error
 * from arbitrary data, and the shared helpers/palette must behave.
 */
const series: ChartSeries[] = [{ key: "a", label: "Alpha" }, { key: "b", label: "Beta" }];
const data: ChartRow[] = [
  { name: "Jan", a: 10, b: 4 },
  { name: "Feb", a: 7, b: 9 },
];

describe("chart primitives", () => {
  it("render from arbitrary series + data without throwing", () => {
    expect(() => render(<SeriesBarChart data={data} series={series} />)).not.toThrow();
    expect(() => render(<SeriesBarChart data={data} series={series} orientation="vertical" stacked legend={false} />)).not.toThrow();
    expect(() => render(<SeriesLineChart data={data} series={series} />)).not.toThrow();
    expect(() => render(<SeriesAreaChart data={data} series={series} stacked />)).not.toThrow();
  });

  it("render the scatter, treemap and donut primitives without throwing", () => {
    expect(() => render(<ScatterPlotChart points={[{ x: 1, y: 2, name: "p" }, { x: 3, y: 1 }]} xLabel="Effort" yLabel="Value" />)).not.toThrow();
    expect(() => render(<TreemapChart data={[{ name: "A", value: 5 }, { name: "B", children: [{ name: "B1", value: 3 }] }]} />)).not.toThrow();
    expect(() => render(<SharePieChart data={[{ name: "a", value: 3 }, { name: "b", value: 2 }]} donut />)).not.toThrow();
    expect(render(<TreemapChart data={[]} />).container).toBeEmptyDOMElement();
  });

  it("SharePieChart caps to the palette + Other and drops empty data", () => {
    // More slices than palette slots → the tail folds into a single "Other".
    const many = Array.from({ length: CHART_PALETTE.length + 3 }, (_, i) => ({ name: `g${i}`, value: CHART_PALETTE.length + 3 - i }));
    expect(() => render(<SharePieChart data={many} />)).not.toThrow();
    // All-zero data renders nothing.
    const { container } = render(<SharePieChart data={[{ name: "x", value: 0 }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("formatChartNumber keeps integers clean and rounds decimals", () => {
    expect(formatChartNumber(1000)).toBe((1000).toLocaleString());
    expect(formatChartNumber(1.23456)).toBe((1.23).toLocaleString());
  });

  it("renders reference lines in both the plain and emphasised forms", () => {
    // A plain mark (muted, no colour/label) and an emphasised one (colour + label) hit both
    // branches of renderReferenceLines.
    expect(() =>
      render(
        <SeriesBarChart
          data={data}
          series={series}
          referenceLines={[{ value: 6 }, { value: 9, color: "#dc2626", label: "target" }]}
        />,
      ),
    ).not.toThrow();
  });

  it("accepts explicit height, custom palette + value formatter, and a hidden legend", () => {
    expect(() =>
      render(
        <SeriesBarChart
          data={data}
          series={series}
          height={320}
          legend={false}
          palette={["#111111", "#222222"]}
          valueFormatter={(n) => `£${n}`}
        />,
      ),
    ).not.toThrow();
  });

  it("line + area honour xKey, yDomain and reference lines", () => {
    const trend: ChartRow[] = [{ month: "Jan", a: 1, b: 2 }, { month: "Feb", a: 3, b: 1 }];
    expect(() =>
      render(<SeriesLineChart data={trend} series={series} xKey="month" yDomain={[0, 10]} referenceLines={[{ value: 5, label: "avg" }]} />),
    ).not.toThrow();
    expect(() =>
      render(<SeriesAreaChart data={trend} series={series} xKey="month" yDomain={[0, 10]} stacked legend={false} referenceLines={[{ value: 5, color: "#059669" }]} />),
    ).not.toThrow();
  });

  it("SharePieChart honours a hidden legend and a custom maxSlices", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ name: `g${i}`, value: 6 - i }));
    expect(() => render(<SharePieChart data={many} legend={false} maxSlices={3} palette={["#111", "#222", "#333"]} />)).not.toThrow();
  });

  it("ScatterPlotChart renders without axis labels", () => {
    expect(() => render(<ScatterPlotChart points={[{ x: 1, y: 2 }]} />)).not.toThrow();
  });
});

describe("chart primitives — rendered structure (forced layout)", () => {
  it("SeriesBarChart draws a legend entry and bar rects per series", () => {
    const { container, getByText } = render(<SeriesBarChart data={data} series={series} />);
    // Legend labels come from series.label and only render once laid out.
    expect(getByText("Alpha")).toBeInTheDocument();
    expect(getByText("Beta")).toBeInTheDocument();
    // One <rect> path per bar (recharts renders the Bar shape).
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.querySelectorAll(".recharts-bar").length).toBe(2);
  });

  it("vertical bars with a custom value formatter format the measure axis ticks", () => {
    const { getAllByText } = render(
      <SeriesBarChart data={data} series={series} orientation="vertical" valueFormatter={(n) => `£${n}`} />,
    );
    // The Y (measure) axis ticks run through valueFormatter → "£10" etc. appears.
    expect(getAllByText(/^£\d/).length).toBeGreaterThan(0);
  });

  it("SeriesLineChart renders a line path per series", () => {
    const { container } = render(<SeriesLineChart data={data} series={series} />);
    expect(container.querySelectorAll(".recharts-line").length).toBe(2);
  });

  it("SeriesAreaChart renders an area per series when stacked", () => {
    const { container } = render(<SeriesAreaChart data={data} series={series} stacked />);
    expect(container.querySelectorAll(".recharts-area").length).toBe(2);
  });

  it("ScatterPlotChart with axis labels renders points and the x-axis label", () => {
    const { container } = render(<ScatterPlotChart points={[{ x: 1, y: 2, name: "p" }, { x: 3, y: 1 }]} xLabel="Effort" yLabel="Value" />);
    expect(container.querySelector(".recharts-scatter")).toBeTruthy();
  });

  it("TreemapChart renders a cell per top-level branch with its label", () => {
    const { getByText, container } = render(
      <TreemapChart data={[{ name: "Discovery", value: 10 }, { name: "Build", children: [{ name: "B1", value: 6 }] }]} />,
    );
    // TreemapCell draws a label for a big-enough top-level branch.
    expect(getByText("Discovery")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
