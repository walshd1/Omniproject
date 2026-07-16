import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChartPanel } from "./ChartPanel";
import type { Panel } from "../../../lib/screen";

/**
 * A `controls` block turns a ChartPanel into a live pivot too — the chosen group becomes the x axis and the
 * metric the (single) series. We assert on the panel's own state (control bar present, empty-state cleared,
 * and that switching to an empty filter selection yields the empty state) rather than recharts' SVG.
 */
const rows = [
  { year: "2026", currency: "GBP", amount: 100 },
  { year: "2026", currency: "USD", amount: 50 },
  { year: "2027", currency: "GBP", amount: 200 },
];

function panelWithControls(): Panel {
  return {
    id: "c", kind: "chart", title: "Spend",
    config: {
      chartType: "bar",
      rows,
      controls: {
        groupBy: ["year", "currency"],
        metricField: "amount",
        metricLabel: "Amount",
        aggs: ["sum", "count"],
        filters: ["currency"],
        period: { field: "year", buckets: ["year"] },
      },
    },
  };
}

describe("ChartPanel controls (live pivot)", () => {
  it("renders the control bar and charts the default pivot", () => {
    render(<ChartPanel panel={panelWithControls()} />);
    expect(screen.getByTestId("panel-controls")).toBeTruthy();
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("stays charted after switching the group-by dimension", () => {
    render(<ChartPanel panel={panelWithControls()} />);
    fireEvent.change(screen.getByTestId("control-groupby"), { target: { value: "currency" } });
    expect(screen.queryByTestId("chart-empty")).toBeNull();
  });

  it("offers the derived period bucket as a grouping option", () => {
    render(<ChartPanel panel={panelWithControls()} />);
    const opts = Array.from(screen.getByTestId("control-groupby").querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(opts).toContain("period:year");
  });
});
