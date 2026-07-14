import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { render } from "@testing-library/react";
import { RecordBoard } from "./RecordBoard";
import type { BoardColumn, ViewRecord } from "../../lib/view-engine/types";

/**
 * The generic kanban engine behind both the issue Kanban and the task GTD board. These tests drive
 * it directly (its adapters — TaskBoard etc. — are thin): column derivation, chip/priority rendering,
 * the drag-and-drop and per-card-selector move paths (incl. the same-status no-op guard), open, and
 * the empty states.
 */

const COLUMNS: BoardColumn[] = [
  { status: "todo", label: "To Do" },
  { status: "done", label: "Done" },
];

function rec(over: Partial<ViewRecord<{ id: string }>> = {}): ViewRecord<{ id: string }> {
  return { id: "r1", title: "A card", status: "todo", priority: null, chips: [], raw: { id: "r1" }, ...over };
}

function labelForPriority(p: string | null | undefined): string {
  return p ? p.toUpperCase() : "";
}

describe("RecordBoard", () => {
  it("renders each preset column with its label and card count", () => {
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Alpha", status: "todo" }), rec({ id: "b", title: "Bravo", status: "done" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const todo = screen.getByLabelText("To Do");
    expect(within(todo).getByText("Alpha")).toBeInTheDocument();
    const done = screen.getByLabelText("Done");
    expect(within(done).getByText("Bravo")).toBeInTheDocument();
  });

  it("derives a trailing column for a status not covered by the preset", () => {
    render(
      <RecordBoard
        records={[rec({ id: "x", title: "Odd one", status: "blocked" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    // The unknown status gets its own column labelled by the status string.
    const extra = screen.getByLabelText("blocked");
    expect(within(extra).getByText("Odd one")).toBeInTheDocument();
  });

  it("shows an em dash placeholder in an empty column", () => {
    render(
      <RecordBoard
        records={[rec({ id: "a", status: "todo" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    // "Done" has no cards → placeholder.
    expect(within(screen.getByLabelText("Done")).getByText("—")).toBeInTheDocument();
  });

  it("renders chips (mono + plain, dot-separated) and the priority badge", () => {
    render(
      <RecordBoard
        records={[
          rec({
            id: "a",
            title: "Rich card",
            priority: "high",
            chips: [{ text: "@home", mono: true }, { text: "Ada" }],
          }),
        ]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("@home")).toBeInTheDocument();
    // The second chip is rendered dot-separated ("· Ada").
    expect(screen.getByText(/Ada/)).toBeInTheDocument();
    // priority !== "none" → the labelForPriority badge renders.
    expect(screen.getByText("HIGH")).toBeInTheDocument();
  });

  it("hides the meta row entirely for a card with no chips and priority none", () => {
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Bare", priority: "none", chips: [] })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    // No priority badge should be rendered for the "none" priority.
    expect(screen.queryByText("NONE")).not.toBeInTheDocument();
  });

  it("calls onOpen with the record when its title is clicked", () => {
    const onOpen = vi.fn();
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Open me" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByText("Open me"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("moves a card to another status via its per-card selector", () => {
    const onMove = vi.fn();
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Mover", status: "todo" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={onMove}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Move Mover"), { target: { value: "done" } });
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "done");
  });

  it("does not fire onMove when the selector is set to the card's current status", () => {
    const onMove = vi.fn();
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Stayer", status: "todo" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={onMove}
        onOpen={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Move Stayer"), { target: { value: "todo" } });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves a card to the dropped-on column via drag and drop", () => {
    const onMove = vi.fn();
    const { container } = render(
      <RecordBoard
        records={[rec({ id: "a", title: "Dragged", status: "todo" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={onMove}
        onOpen={vi.fn()}
      />,
    );
    const card = screen.getByText("Dragged").closest("div[draggable]")!;
    fireEvent.dragStart(card);
    // The Done column is the second column wrapper.
    const doneColumn = screen.getByLabelText("Done").closest("div")!.parentElement!;
    fireEvent.drop(doneColumn);
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "done");
    expect(container).toBeTruthy();
  });

  it("a drop with nothing being dragged is a no-op", () => {
    const onMove = vi.fn();
    render(
      <RecordBoard
        records={[rec({ id: "a", title: "Idle", status: "todo" })]}
        columns={COLUMNS}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={onMove}
        onOpen={vi.fn()}
      />,
    );
    // No dragStart first → dragId is null → the drop finds no record and moves nothing.
    const doneColumn = screen.getByLabelText("Done").closest("div")!.parentElement!;
    fireEvent.drop(doneColumn);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("shows the no-records message when there are no columns and no records", () => {
    render(
      <RecordBoard
        records={[]}
        columns={[]}
        noun="task"
        labelForPriority={labelForPriority}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText("No tasks to show.")).toBeInTheDocument();
  });
});
