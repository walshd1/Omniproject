import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChartPanel } from "./ChartPanel";
import type { Panel } from "../../../lib/screen";

/**
 * ChartPanel draws bar/line/area/pie from OBJECT-ROWS (the rows/rollup endpoint shape) through the shared
 * ChartView. These cover the panel's own logic — empty-state, title, and that it accepts a rolled-up
 * source shape — without asserting on recharts' internal SVG (covered by ChartView's own tests).
 */
describe("ChartPanel", () => {
  it("shows an empty state when there are no rows", () => {
    const panel: Panel = { id: "c", kind: "chart", title: "Budget by year", config: { chartType: "bar" } };
    render(<ChartPanel panel={panel} />);
    expect(screen.getByTestId("chart-empty")).toBeTruthy();
  });

  it("renders the title and no empty-state when given rolled-up rows", () => {
    const panel: Panel = {
      id: "c", kind: "chart", title: "Budget by year",
      config: { chartType: "bar", xKey: "year", series: [{ key: "amount", label: "Planned" }], rows: [{ year: "2026", amount: 100 }, { year: "2027", amount: 250 }] },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
    expect(screen.getByText("Budget by year")).toBeTruthy();
  });

  it("infers x + series from the rows when config omits them", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: { chartType: "bar", rows: [{ year: "2026", amount: 100 }] },
    };
    // Should not throw and should not fall back to the empty state (a numeric series is inferred).
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("renders a pie chart from rows (maps x → name, series[0] → value)", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: {
        chartType: "pie", xKey: "team", series: [{ key: "count", label: "Count" }],
        rows: [{ team: "A", count: 3 }, { team: "B", count: 5 }],
      },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("renders a line chart from rows", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: {
        chartType: "line", xKey: "month", series: [{ key: "value", label: "Value" }],
        rows: [{ month: "Jan", value: 1 }, { month: "Feb", value: 4 }],
      },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("renders a stacked area chart with the legend hidden", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: {
        chartType: "area", stacked: true, legend: false, xKey: "month",
        series: ["a", "b"],
        rows: [{ month: "Jan", a: 1, b: 2 }, { month: "Feb", a: 3, b: 1 }],
      },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("coerces string-numeric series values and ignores non-object rows", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: {
        chartType: "bar", xKey: "year", series: [{ key: "amount", label: "Amount" }],
        rows: [{ year: "2026", amount: "100" }, "junk", 42, [1, 2], { year: "2027", amount: "oops" }],
      },
    };
    render(<ChartPanel panel={panel} />);
    // Two valid object rows survive the filter ⇒ still charted, not empty.
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("shows the empty state when rows exist but no numeric series can be inferred", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: { chartType: "bar", rows: [{ label: "only-text" }] },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.getByTestId("chart-empty")).toBeTruthy();
  });

  it("defaults to a bar chart when chartType is missing or unknown", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: { chartType: "bogus", rows: [{ year: "2026", amount: 100 }] },
    };
    render(<ChartPanel panel={panel} />);
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });
});
