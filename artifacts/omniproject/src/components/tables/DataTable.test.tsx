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

  it("toggles sort direction on repeated header clicks, reflecting it in aria-sort", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} testId="t" />);
    const nameBtn = screen.getByRole("button", { name: /name/i });
    fireEvent.click(nameBtn); // ascending
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute("aria-sort", "ascending");
    let bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Alpha")).toBeInTheDocument();

    fireEvent.click(nameBtn); // descending
    expect(screen.getByRole("columnheader", { name: /name/i })).toHaveAttribute("aria-sort", "descending");
    bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    expect(within(bodyRows[0]!).getByText("Bravo")).toBeInTheDocument();
  });

  it("honours an initialSort so rows start sorted without any interaction", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} initialSort={{ key: "score", dir: 1 }} testId="t" />);
    const bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    // Ascending by score: Bravo (5) before Alpha (9).
    expect(within(bodyRows[0]!).getByText("Bravo")).toBeInTheDocument();
  });

  it("leaves rows in source order when the sorted column has no sortValue", () => {
    const noSort: DataColumn<Row>[] = [{ key: "name", label: "Name" }];
    render(<DataTable columns={noSort} rows={rows} rowKey={(r) => r.id} initialSort={{ key: "name", dir: 1 }} testId="t" />);
    const bodyRows = within(screen.getByTestId("t")).getAllByRole("row").slice(1);
    // No sortValue on the column ⇒ original order preserved (Bravo first).
    expect(within(bodyRows[0]!).getByText("Bravo")).toBeInTheDocument();
    // A non-sortable column renders a plain header, not a sort button.
    expect(screen.queryByRole("button", { name: /name/i })).not.toBeInTheDocument();
  });

  it("renders a caption and stringifies cells for a column with no custom render", () => {
    const cols: DataColumn<Row>[] = [{ key: "name", label: "Name" }];
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} caption="People" dense testId="t" />);
    expect(screen.getByText("People")).toBeInTheDocument();
    // Default cell renderer stringifies row[key].
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("right-aligns a column marked align=right", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} testId="t" />);
    const header = screen.getByRole("columnheader", { name: /score/i });
    expect(header.className).toContain("text-right");
  });

  it("centre-aligns a column marked align=center", () => {
    const cols: DataColumn<Row>[] = [{ key: "name", label: "Name", align: "center" }];
    render(<DataTable columns={cols} rows={rows} rowKey={(r) => r.id} testId="t" />);
    expect(screen.getByRole("columnheader", { name: /name/i }).className).toContain("text-center");
  });
});
