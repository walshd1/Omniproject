import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RecordTable } from "./RecordTable";
import type { EntityField, ViewRecord } from "../../lib/view-engine/types";

interface W { id: string; status: string; assignee: string }
const F: EntityField<W>[] = [
  { key: "status", label: "Status", get: (w) => w.status },
  { key: "assignee", label: "Assignee", get: (w) => w.assignee },
];
const rec = (id: string, status: string, assignee: string): ViewRecord<W> => ({ id, title: id.toUpperCase(), status, priority: null, chips: [], raw: { id, status, assignee } });
const RECS = [rec("b", "todo", "sam"), rec("a", "done", "pat")];

describe("RecordTable", () => {
  it("renders only the chosen columns", () => {
    render(<RecordTable records={RECS} fields={F} columns={["status"]} noun="widget" onOpen={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /assignee/i })).not.toBeInTheDocument();
  });

  it("shows all fields when no columns given", () => {
    render(<RecordTable records={RECS} fields={F} noun="widget" onOpen={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /assignee/i })).toBeInTheDocument();
  });

  it("sorts by a column header click", () => {
    render(<RecordTable records={RECS} fields={F} noun="widget" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    const rows = screen.getAllByRole("row").slice(1); // drop header row
    // Ascending by status: "done" (A) before "todo" (B).
    expect(within(rows[0]!).getByText("A")).toBeInTheDocument();
  });

  it("opens a record on title click", () => {
    const onOpen = vi.fn();
    render(<RecordTable records={RECS} fields={F} noun="widget" onOpen={onOpen} />);
    fireEvent.click(screen.getByText("B"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("falls back to all fields when an empty columns array is given", () => {
    render(<RecordTable records={RECS} fields={F} columns={[]} noun="widget" onOpen={() => {}} />);
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /assignee/i })).toBeInTheDocument();
  });

  it("renders an em dash for a field whose value is null/undefined", () => {
    const recs = [{ id: "n", title: "N", status: "todo", priority: null, chips: [], raw: { id: "n", status: "todo", assignee: "" } } as ViewRecord<W>];
    // Assignee getter returns "" here; use a field whose getter yields undefined to hit the ?? "—".
    const withNull: EntityField<W>[] = [{ key: "assignee", label: "Assignee", get: () => undefined as unknown as string }];
    render(<RecordTable records={recs} fields={withNull} noun="widget" onOpen={() => {}} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the empty-state with a noun-scoped test id when there are no records", () => {
    render(<RecordTable records={[]} fields={F} noun="widget" onOpen={() => {}} />);
    expect(screen.getByTestId("widget-table-empty")).toHaveTextContent("No widgets.");
  });
});
