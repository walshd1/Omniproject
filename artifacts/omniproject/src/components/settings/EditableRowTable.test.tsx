import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditableRowTable, type EditableColumn } from "./EditableRowTable";

interface Row { name: string; bad: boolean }
const COLUMNS: EditableColumn<Row>[] = [
  { header: "Name", cell: (r, i) => <input aria-label={`name-${i}`} defaultValue={r.name} /> },
];

describe("EditableRowTable", () => {
  it("renders headers with a trailing remove column, plus per-row testids and inputs", () => {
    render(
      <EditableRowTable
        columns={COLUMNS}
        rows={[{ name: "a", bad: false }, { name: "b", bad: true }]}
        rowKey={(_, i) => i}
        rowTestId={(_, i) => `row-${i}`}
        onRemove={() => {}}
        removeLabel={(i) => `Remove ${i + 1}`}
        emptyText="Nothing."
      />,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByTestId("row-0")).toBeInTheDocument();
    expect(screen.getByLabelText("name-0")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove 2")).toBeInTheDocument();
  });

  it("calls onRemove with the row index when × is clicked", () => {
    const onRemove = vi.fn();
    render(
      <EditableRowTable
        columns={COLUMNS}
        rows={[{ name: "a", bad: false }, { name: "b", bad: false }]}
        rowKey={(_, i) => i}
        onRemove={onRemove}
        removeLabel={(i) => `Remove ${i + 1}`}
        emptyText="Nothing."
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove 2"));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it("applies the per-row highlight class from rowClassName", () => {
    render(
      <EditableRowTable
        columns={COLUMNS}
        rows={[{ name: "a", bad: false }, { name: "b", bad: true }]}
        rowKey={(_, i) => i}
        rowTestId={(_, i) => `row-${i}`}
        rowClassName={(r) => (r.bad ? "bg-red-500/10" : undefined)}
        onRemove={() => {}}
        removeLabel={(i) => `Remove ${i + 1}`}
        emptyText="Nothing."
      />,
    );
    expect(screen.getByTestId("row-1").className).toContain("bg-red-500/10");
    expect(screen.getByTestId("row-0").className).not.toContain("bg-red-500/10");
  });

  it("shows the empty-state row (spanning all columns) when there are no rows", () => {
    render(
      <EditableRowTable
        columns={COLUMNS}
        rows={[]}
        rowKey={(_, i) => i}
        onRemove={() => {}}
        removeLabel={(i) => `Remove ${i + 1}`}
        emptyText="No entries yet."
      />,
    );
    const empty = screen.getByText("No entries yet.");
    expect(empty).toBeInTheDocument();
    expect(empty.getAttribute("colspan")).toBe("2"); // 1 column + the remove column
  });
});
