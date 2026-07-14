import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportTable, type ReportColumn } from "./ReportTable";

interface Row { id: string; name: string; amount: number; over: boolean }
const ROWS: Row[] = [
  { id: "a", name: "Alpha", amount: 10, over: false },
  { id: "b", name: "Beta", amount: 20, over: true },
];

const COLUMNS: ReportColumn<Row>[] = [
  { header: "Name", cell: (r) => r.name },
  { header: "Amount", align: "right", cell: (r) => `£${r.amount}`, cellClassName: (r) => (r.over ? "text-red-500" : "") },
];

describe("ReportTable", () => {
  it("renders headers, rows and cells with per-row testids", () => {
    render(<ReportTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowTestId={(r) => `row-${r.id}`} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByTestId("row-a")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("row-a")).toHaveTextContent("£10");
    expect(screen.getByTestId("row-b")).toHaveTextContent("Beta");
  });

  it("right-aligns numeric columns (tabular-nums) and applies conditional cell classes", () => {
    render(<ReportTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} rowTestId={(r) => `row-${r.id}`} />);
    const overCell = screen.getByText("£20");
    expect(overCell.className).toContain("text-right");
    expect(overCell.className).toContain("tabular-nums");
    expect(overCell.className).toContain("text-red-500");
    // Non-over row must NOT get the conditional colour.
    expect(screen.getByText("£10").className).not.toContain("text-red-500");
  });

  it("supports per-cell testids and the comfortable size (top-aligned rows)", () => {
    const cols: ReportColumn<Row>[] = [
      { header: "Name", cell: (r) => r.name, testId: (r) => `name-${r.id}` },
    ];
    render(<ReportTable columns={cols} rows={ROWS} rowKey={(r) => r.id} rowTestId={(r) => `r-${r.id}`} size="comfortable" />);
    expect(screen.getByTestId("name-a")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("r-a").className).toContain("align-top");
  });

  it("renders an empty tbody (no rows) without throwing", () => {
    render(<ReportTable columns={COLUMNS} rows={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });
});
