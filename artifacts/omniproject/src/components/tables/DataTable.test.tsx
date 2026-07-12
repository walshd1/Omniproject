import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { DataTable, type DataColumn } from "./DataTable";

interface Row { id: string; name: string; score: number }
const rows: Row[] = [
  { id: "a", name: "Bravo", score: 5 },
  { id: "b", name: "Alpha", score: 9 },
];
const columns: DataColumn<Row>[] = [
  { key: "name", label: "Name", sortable: true, sortValue: (r) => r.name },
  { key: "score", label: "Score", align: "right", sortable: true, sortValue: (r) => r.score, render: (r) => <b>{r.score}</b> },
];

describe("DataTable", () => {
  it("renders columns and rows, using a column's custom render", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} testId="t" />);
    expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument();
    const bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Bravo")).toBeInTheDocument();
  });

  it("sorts by a sortable column on header click", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} testId="t" />);
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    const bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    // Ascending by name: Alpha before Bravo.
    expect(within(bodyRows[0]!).getByText("Alpha")).toBeInTheDocument();
  });

  it("renders a footer row when supplied", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} footer={<tr><td>Total</td></tr>} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});
