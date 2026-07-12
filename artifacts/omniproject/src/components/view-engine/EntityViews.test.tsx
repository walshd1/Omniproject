import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { EntityViews } from "./EntityViews";
import type { EntityDescriptor, ViewRecord } from "../../lib/view-engine/types";

// The engine loads shared saved views over /api/views; stub it so these tests stay network-free.
let savedData: unknown[] = [];
vi.mock("../../lib/saved-views", () => ({ useSavedViews: () => ({ data: savedData }) }));

/**
 * The generic view engine is entity-agnostic — it renders whatever an EntityDescriptor supplies.
 * These tests drive it with a synthetic "widget" descriptor (no network) to prove the engine itself:
 * list is the default, every board column-preset is selectable (GTD has no special status — it's
 * just one preset), the list status-filter narrows, and the complete checkbox moves status.
 */
interface Widget { id: string; title: string; status: string }
const WIDGETS: Widget[] = [
  { id: "w1", title: "Alpha", status: "next" },
  { id: "w2", title: "Bravo", status: "waiting" },
];
function toRecord(w: Widget): ViewRecord<Widget> {
  return { id: w.id, title: w.title, status: w.status, priority: null, chips: [], raw: w };
}

const move = vi.fn();
function makeDescriptor(): EntityDescriptor<Widget> {
  return {
    entity: "widget",
    noun: "widget",
    presets: [
      { id: "gtd", label: "GTD Board", columns: [{ status: "next", label: "Next Actions" }, { status: "waiting", label: "Waiting For" }] },
      { id: "flow", label: "Flow", columns: [{ status: "next", label: "To do" }, { status: "done", label: "Done" }] },
    ],
    fields: [{ key: "status", label: "Status", get: (w) => w.status }],
    filterStatuses: ["next", "waiting", "done"],
    closedStatuses: ["done"],
    doneStatus: "done",
    reopenStatus: "next",
    useRecords: () => ({ records: WIDGETS.map(toRecord), isLoading: false, error: null }),
    useMove: () => move,
    usePriorityLabel: () => (p) => p ?? "",
  };
}

describe("EntityViews (generic engine)", () => {
  it("defaults to the list view and shows all records", () => {
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("offers every board preset as a selectable view — GTD is just one of them", () => {
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
    // Both presets are present as view tabs alongside List.
    expect(screen.getByRole("tab", { name: "GTD Board" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Flow" })).toBeInTheDocument();

    // Selecting GTD renders its columns; Bravo sits under Waiting For.
    fireEvent.click(screen.getByRole("tab", { name: "GTD Board" }));
    const waiting = screen.getByLabelText("Waiting For");
    expect(within(waiting).getByText("Bravo")).toBeInTheDocument();

    // Switching to the Flow preset renders a different column set (To do / Done).
    fireEvent.click(screen.getByRole("tab", { name: "Flow" }));
    expect(screen.getByLabelText("To do")).toBeInTheDocument();
    expect(screen.getByLabelText("Done")).toBeInTheDocument();
  });

  it("narrows the list by status filter", () => {
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "waiting" }));
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
  });

  it("completing a record from the list moves it to the done status", () => {
    move.mockClear();
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
    fireEvent.click(screen.getByLabelText("Complete Alpha"));
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }), "done");
  });

  it("opens a record's detail via the raw entity", () => {
    const onOpen = vi.fn();
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={onOpen} />);
    fireEvent.click(screen.getByText("Alpha"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ raw: expect.objectContaining({ id: "w1" }) }));
  });

  it("renders the built-in Table view with sortable field columns", () => {
    renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByTestId("record-table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
  });

  it("renders a saved table view limited to its chosen columns", () => {
    savedData = [{ id: "sv2", name: "Widget table", entity: "widget", viewKind: "table", columns: ["status"] }];
    try {
      renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
      fireEvent.click(screen.getByRole("tab", { name: "Widget table" }));
      expect(screen.getByTestId("record-table")).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /status/i })).toBeInTheDocument();
    } finally {
      savedData = [];
    }
  });

  it("surfaces a custom saved view as a tab and applies its filter", () => {
    savedData = [{ id: "sv1", name: "Only waiting", entity: "widget", viewKind: "list", filters: [{ field: "status", value: "waiting" }] }];
    try {
      renderWithProviders(<EntityViews descriptor={makeDescriptor()} onOpen={() => {}} />);
      fireEvent.click(screen.getByRole("tab", { name: "Only waiting" }));
      // The saved view filters to status=waiting: Bravo shows, Alpha doesn't.
      expect(screen.getByText("Bravo")).toBeInTheDocument();
      expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    } finally {
      savedData = [];
    }
  });
});
