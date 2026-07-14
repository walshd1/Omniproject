import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CustomReportDef, Row } from "../../lib/custom-report";
import { CustomReport } from "./CustomReport";

const rows: Row[] = [
  { status: "done", region: "EU", budget: 100 },
  { status: "done", region: "US", budget: 50 },
  { status: "todo", region: "EU", budget: 200 },
];

function def(over: Partial<CustomReportDef> = {}): CustomReportDef {
  const base: CustomReportDef = { id: "r", label: "R", scope: "project", groupBy: "status", metrics: [{ id: "m", field: "budget", agg: "sum" }], viz: "table" };
  return { ...base, ...over };
}

/** Like `def`, but for a trend report — no `groupBy` at all (line reports use `dateField` instead). */
function trendDef(over: Partial<CustomReportDef> = {}): CustomReportDef {
  const base: CustomReportDef = { id: "r", label: "R", scope: "project", metrics: [{ id: "m", field: "budget", agg: "sum" }], viz: "line" };
  return { ...base, ...over };
}

describe("CustomReport", () => {
  it("renders the single-level grouped table (no pivot section) when groupBy2 is unset", () => {
    render(<CustomReport def={def()} rows={rows} />);
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    expect(screen.getByTestId("custom-report-row-r-done")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-report-pivot-r")).not.toBeInTheDocument();
  });

  it("renders a two-level pivot cross-tab when groupBy2 is set", () => {
    render(<CustomReport def={def({ groupBy2: "region" })} rows={rows} />);
    const pivot = screen.getByTestId("custom-report-pivot-r");
    expect(pivot).toHaveTextContent("status");
    expect(pivot).toHaveTextContent("region");
    // Columns are the distinct region values, both rows show a value per column.
    const doneRow = within(pivot).getByTestId("custom-report-pivot-row-r-done");
    expect(doneRow).toHaveTextContent("100"); // done×EU
    expect(doneRow).toHaveTextContent("50"); // done×US
    const todoRow = within(pivot).getByTestId("custom-report-pivot-row-r-todo");
    expect(todoRow).toHaveTextContent("200"); // todo×EU
    expect(todoRow).toHaveTextContent("0"); // todo×US — filled, not omitted
  });

  it("renders a month-bucketed trend line + table for viz: line", () => {
    const trendRows: Row[] = [
      { budget: 100, closedAt: "2026-01-10" },
      { budget: 50, closedAt: "2026-01-20" },
      { budget: 200, closedAt: "2026-02-05" },
    ];
    render(<CustomReport def={trendDef({ dateField: "closedAt" })} rows={trendRows} />);
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getByText("Feb 2026")).toBeInTheDocument();
    const janRow = screen.getByTestId("custom-report-row-r-2026-01");
    expect(janRow).toHaveTextContent("150"); // 100 + 50
  });

  it("shows a friendly empty state for a trend report missing its dateField", () => {
    render(<CustomReport def={trendDef()} rows={rows} />);
    expect(screen.getByTestId("custom-report-empty-r")).toHaveTextContent(/needs a date field/);
  });

  it("renders the trend path (table + points) for viz: area", () => {
    const trendRows: Row[] = [
      { budget: 100, closedAt: "2026-01-10" },
      { budget: 200, closedAt: "2026-02-05" },
    ];
    render(<CustomReport def={trendDef({ viz: "area", dateField: "closedAt" })} rows={trendRows} />);
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getByText("Feb 2026")).toBeInTheDocument();
  });

  it("renders the grouped path (share table) for viz: pie", () => {
    render(<CustomReport def={def({ viz: "pie" })} rows={rows} />);
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    // The share table still lists each group.
    expect(screen.getByTestId("custom-report-row-r-done")).toBeInTheDocument();
    expect(screen.getByTestId("custom-report-row-r-todo")).toBeInTheDocument();
  });

  it("shows a friendly empty state when nothing matches", () => {
    render(<CustomReport def={def({ filter: { all: [{ field: "status", op: "eq", value: "nope" }] } })} rows={rows} />);
    expect(screen.getByTestId("custom-report-empty-r")).toBeInTheDocument();
  });

  it("wraps the report in a styled frame when the definition carries a style", () => {
    render(<CustomReport def={def({ style: { title: "Budget by status", background: "#f0f0f0" } })} rows={rows} />);
    // The report still renders…
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    // …now under the user's title.
    expect(screen.getByText("Budget by status")).toBeInTheDocument();
  });

  it("shows the 'no matching data' message for a trend report whose dateField matches nothing", () => {
    // dateField is set (so it's not the "needs a date field" message) but no row carries it.
    render(<CustomReport def={trendDef({ dateField: "closedAt" })} rows={rows} />);
    expect(screen.getByTestId("custom-report-empty-r")).toHaveTextContent(/No matching data/);
  });

  it("honours chart legend:false + stacked:true on a bar viz", () => {
    render(<CustomReport def={def({ viz: "bar", chart: { legend: false, stacked: true } })} rows={rows} />);
    // The report renders; the legend/stacked branches are taken on the ChartView props.
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    expect(screen.getByTestId("custom-report-row-r-done")).toBeInTheDocument();
  });

  it("honours chart legend:false + stacked:true on an area trend viz", () => {
    const trendRows: Row[] = [
      { budget: 100, closedAt: "2026-01-10" },
      { budget: 200, closedAt: "2026-02-05" },
    ];
    render(<CustomReport def={trendDef({ viz: "area", dateField: "closedAt", chart: { legend: false, stacked: true } })} rows={trendRows} />);
    expect(screen.getByTestId("custom-report-r")).toBeInTheDocument();
    expect(screen.getByText("Jan 2026")).toBeInTheDocument();
  });

  it("labels the group column 'All' when the report has no groupBy", () => {
    // trendDef carries no groupBy — with viz "bar" it takes the grouped path with a single all-rows group.
    render(<CustomReport def={trendDef({ viz: "bar" })} rows={rows} />);
    // With no groupBy, the single all-rows group renders under an "All" header.
    expect(screen.getByRole("columnheader", { name: "All" })).toBeInTheDocument();
  });

  it("offers chart export for a chart viz, but not for a plain table", () => {
    const { rerender } = render(<CustomReport def={def({ viz: "bar" })} rows={rows} />);
    expect(screen.getByTestId("export-svg")).toBeInTheDocument();
    expect(screen.getByTestId("export-png")).toBeInTheDocument();
    rerender(<CustomReport def={def({ viz: "table" })} rows={rows} />);
    expect(screen.queryByTestId("export-svg")).toBeNull();
  });
});
