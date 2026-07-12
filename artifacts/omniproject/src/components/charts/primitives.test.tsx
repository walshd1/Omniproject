import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
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
});
