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
});
