import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { overdueDrillTo } from "../../../lib/drill-to";
import type { Panel } from "../../../lib/screen";

/**
 * ChartPanel drill-through: a `drillTo` descriptor makes the chart clickable — a bar/slice click resolves
 * the drill against that category's SOURCE row and navigates. We stub ChartView to invoke onDatumClick so
 * the test exercises ChartPanel's resolve+navigate wiring without recharts' SVG hit-testing.
 */
vi.mock("../../charts/ChartView", () => ({
  ChartView: ({ onDatumClick }: { onDatumClick?: (d: { name: string }) => void }) =>
    onDatumClick ? <button data-testid="fake-bar" onClick={() => onDatumClick({ name: "2026" })}>bar</button> : <div data-testid="chart-static" />,
}));

const { ChartPanel } = await import("./ChartPanel");

describe("ChartPanel drill-through", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("navigates to the filtered grid when a datum is clicked (drillTo set)", () => {
    const panel: Panel = {
      id: "c", kind: "chart",
      config: { chartType: "bar", xKey: "year", series: [{ key: "amount" }], rows: [{ year: "2026", amount: 100, projectId: "p1" }], drillTo: overdueDrillTo() },
    };
    render(<ChartPanel panel={panel} />);
    fireEvent.click(screen.getByTestId("fake-bar"));
    expect(window.location.pathname).toBe("/projects/p1");
    expect(window.location.search).toContain("filter");
  });

  it("passes no click handler when drillTo is absent (non-interactive)", () => {
    const panel: Panel = { id: "c", kind: "chart", config: { chartType: "bar", xKey: "year", series: [{ key: "amount" }], rows: [{ year: "2026", amount: 100 }] } };
    render(<ChartPanel panel={panel} />);
    expect(screen.getByTestId("chart-static")).toBeTruthy();
  });
});
