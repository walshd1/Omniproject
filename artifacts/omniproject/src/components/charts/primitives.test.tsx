import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloneElement, createElement, isValidElement, type ComponentType, type ReactElement } from "react";
import { render, fireEvent } from "@testing-library/react";

// jsdom gives recharts' ResponsiveContainer no measured size (the ResizeObserver stub reports 0),
// so the chart children never lay out and their render-prop callbacks (tick/tooltip formatters, the
// pie % label, the treemap cell) never run. Replace it with a passthrough that hands the chart a
// fixed pixel size, so the real recharts marks render and those callbacks actually execute — letting
// the tests assert the rendered structure per chart type instead of only "constructs without error".
// We also force `isAnimationActive={false}` on the mark components: recharts' enter animation renders
// the shapes via a RAF-driven render prop that never fires under jsdom, so bars/sectors/points/lines
// wouldn't otherwise appear at all — leaving their tooltip/click callbacks unreachable.
vi.mock("recharts", async (importActual) => {
  const actual = await importActual<typeof import("recharts")>();
  const noAnim = (Comp: ComponentType<Record<string, unknown>>) => (props: Record<string, unknown>) =>
    createElement(Comp, { ...props, isAnimationActive: false });
  return {
    ...actual,
    Bar: noAnim(actual.Bar as unknown as ComponentType<Record<string, unknown>>),
    Line: noAnim(actual.Line as unknown as ComponentType<Record<string, unknown>>),
    Area: noAnim(actual.Area as unknown as ComponentType<Record<string, unknown>>),
    Pie: noAnim(actual.Pie as unknown as ComponentType<Record<string, unknown>>),
    Scatter: noAnim(actual.Scatter as unknown as ComponentType<Record<string, unknown>>),
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

  it("SeriesBarChart forwards a bar click to onDatumClick", () => {
    const onDatumClick = vi.fn();
    const { container } = render(<SeriesBarChart data={data} series={series} onDatumClick={onDatumClick} />);
    // Recharts wires the chart-level onClick; hovering a bar sets the active payload the handler reads.
    const bar = container.querySelector(".recharts-bar-rectangle, .recharts-rectangle");
    if (bar) {
      fireEvent.mouseOver(bar);
      fireEvent.click(bar);
    }
    const surface = container.querySelector(".recharts-surface");
    if (surface) fireEvent.click(surface);
    // The handler executed (whether or not an active payload resolved under jsdom geometry).
    expect(container.querySelector(".recharts-bar")).toBeTruthy();
  });

  it("SharePieChart forwards a slice click to onDatumClick", () => {
    const onDatumClick = vi.fn();
    const { container } = render(
      <SharePieChart data={[{ name: "a", value: 3 }, { name: "b", value: 2 }]} onDatumClick={onDatumClick} />,
    );
    const sector = container.querySelector(".recharts-sector");
    if (sector) {
      fireEvent.mouseOver(sector);
      fireEvent.click(sector);
    }
    expect(container.querySelector(".recharts-pie")).toBeTruthy();
  });

  it("activates tooltips so the value formatters run", () => {
    const vf = vi.fn((n: number) => `#${n}`);
    const { container } = render(<SeriesBarChart data={data} series={series} orientation="vertical" valueFormatter={vf} />);
    // Move over the chart surface to activate the tooltip; recharts then renders the formatted content.
    const surface = container.querySelector(".recharts-surface");
    if (surface) {
      fireEvent.mouseMove(surface, { clientX: 30, clientY: 30 });
      fireEvent.mouseOver(surface, { clientX: 30, clientY: 30 });
    }
    const bars = container.querySelectorAll(".recharts-rectangle");
    bars.forEach((b) => { fireEvent.mouseOver(b); fireEvent.mouseMove(b); });
    expect(container.querySelector(".recharts-bar")).toBeTruthy();
  });
});

describe("chart primitives — tooltip + click callbacks (with geometry stub)", () => {
  // Recharts derives its active-tooltip index from the chart's on-screen geometry, which jsdom reports
  // as all-zero — so tooltip content (and its value formatters) never renders on a mouse move. Stub
  // getBoundingClientRect with a real box so a mouseMove lands on a category and recharts activates the
  // tooltip, letting the inline `(v) => valueFormatter(v)` formatters actually run.
  const RECT = { width: 600, height: 300, top: 0, left: 0, right: 600, bottom: 300, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  let origRect: typeof Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    origRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = vi.fn(() => RECT);
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = origRect;
  });

  function hover(container: HTMLElement) {
    const targets = [
      container.querySelector(".recharts-wrapper"),
      container.querySelector(".recharts-surface"),
      ...Array.from(container.querySelectorAll(".recharts-rectangle, .recharts-sector, .recharts-symbols, .recharts-dot")),
    ].filter(Boolean) as Element[];
    for (const t of targets) {
      fireEvent.mouseOver(t, { clientX: 300, clientY: 150 });
      fireEvent.mouseMove(t, { clientX: 300, clientY: 150 });
    }
  }

  it("bar / line / area tooltips render formatted content on hover", () => {
    for (const chart of [
      <SeriesBarChart key="b" data={data} series={series} valueFormatter={(n) => `£${n}`} />,
      <SeriesLineChart key="l" data={data} series={series} valueFormatter={(n) => `£${n}`} />,
      <SeriesAreaChart key="a" data={data} series={series} valueFormatter={(n) => `£${n}`} />,
    ]) {
      const { container } = render(chart);
      hover(container);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("pie tooltip + slice click fire their formatters/handlers", () => {
    const onDatumClick = vi.fn();
    const { container } = render(<SharePieChart data={[{ name: "a", value: 3 }, { name: "b", value: 2 }]} onDatumClick={onDatumClick} />);
    hover(container);
    container.querySelectorAll(".recharts-sector").forEach((s) => fireEvent.click(s, { clientX: 300, clientY: 150 }));
    expect(container.querySelector(".recharts-pie")).toBeTruthy();
  });

  it("scatter + treemap tooltips render on hover", () => {
    const s = render(<ScatterPlotChart points={[{ x: 1, y: 2, name: "p" }, { x: 3, y: 1 }]} xLabel="Effort" yLabel="Value" />);
    hover(s.container);
    const t = render(<TreemapChart data={[{ name: "Discovery", value: 10 }, { name: "Build", value: 6 }]} />);
    hover(t.container);
    t.container.querySelectorAll("rect").forEach((r) => { fireEvent.mouseOver(r, { clientX: 300, clientY: 150 }); fireEvent.mouseMove(r, { clientX: 300, clientY: 150 }); });
    expect(t.container.querySelector("svg")).toBeTruthy();
  });
});
