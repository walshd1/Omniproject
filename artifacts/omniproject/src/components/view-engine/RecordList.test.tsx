import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordList } from "./RecordList";
import type { ViewRecord } from "../../lib/view-engine/types";

/**
 * RecordList — the entity-agnostic list row: a complete/reopen checkbox driven by the closed-status
 * set, metadata chips, and an optional priority badge. Covers the empty state, the open/toggle
 * callbacks, the closed (line-through / reopen-label) branch, chips, and the priority-badge guards.
 */
interface W { id: string }
const rec = (over: Partial<ViewRecord<W>> & { id: string }): ViewRecord<W> => ({
  title: over.id.toUpperCase(), status: "todo", priority: null, chips: [], raw: { id: over.id }, ...over,
});
const label = (p: string | null | undefined) => (p ? p.toUpperCase() : "");

function renderList(records: ViewRecord<W>[], handlers: Partial<{ onToggleDone: (r: ViewRecord<W>) => void; onOpen: (r: ViewRecord<W>) => void }> = {}) {
  return render(
    <RecordList
      records={records}
      noun="widget"
      labelForPriority={label}
      closedStatuses={["done"]}
      onToggleDone={handlers.onToggleDone ?? (() => {})}
      onOpen={handlers.onOpen ?? (() => {})}
      emptyMessage="Nothing here."
    />,
  );
}

describe("RecordList", () => {
  it("shows the empty message with a noun-scoped test id when there are no records", () => {
    renderList([]);
    expect(screen.getByTestId("widget-list-empty")).toHaveTextContent("Nothing here.");
  });

  it("renders an open (unchecked) row with a 'Complete' checkbox label", () => {
    renderList([rec({ id: "a", status: "todo" })]);
    const cb = screen.getByRole("checkbox", { name: "Complete A" });
    expect(cb).not.toBeChecked();
  });

  it("renders a closed row as checked with a 'Reopen' label", () => {
    renderList([rec({ id: "b", status: "done" })]);
    const cb = screen.getByRole("checkbox", { name: "Reopen B" });
    expect(cb).toBeChecked();
  });

  it("calls onToggleDone with the record when its checkbox changes", () => {
    const onToggleDone = vi.fn();
    renderList([rec({ id: "c", status: "todo" })], { onToggleDone });
    fireEvent.click(screen.getByRole("checkbox", { name: "Complete C" }));
    expect(onToggleDone).toHaveBeenCalledWith(expect.objectContaining({ id: "c" }));
  });

  it("calls onOpen with the record when its title button is clicked", () => {
    const onOpen = vi.fn();
    renderList([rec({ id: "d", title: "Open me" })], { onOpen });
    fireEvent.click(screen.getByText("Open me"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "d" }));
  });

  it("renders status, chips (with mono styling) and a priority badge when priority is set", () => {
    renderList([rec({ id: "e", status: "todo", priority: "high", chips: [{ text: "PROJ-1", mono: true }, { text: "3d" }] })]);
    expect(screen.getByText("todo")).toBeInTheDocument();
    const mono = screen.getByText("PROJ-1");
    expect(mono).toHaveClass("font-mono");
    expect(screen.getByText("3d")).not.toHaveClass("font-mono");
    expect(screen.getByText("HIGH")).toBeInTheDocument(); // priority badge via labelForPriority
  });

  it("omits the priority badge when priority is null or 'none'", () => {
    renderList([rec({ id: "f", priority: null }), rec({ id: "g", priority: "none" })]);
    // labelForPriority would upper-case any real priority; neither row shows a badge.
    expect(screen.queryByText("NONE")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
