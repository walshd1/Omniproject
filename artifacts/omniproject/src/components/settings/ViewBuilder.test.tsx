import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { ViewBuilder } from "./ViewBuilder";
import type { SavedView } from "../../lib/saved-views";

/**
 * The view builder lets PMO/admin author named, shared custom views for the generic engine. It's
 * hidden from non-authorities, and saving posts a SavedView carrying entity + viewKind + filters.
 */
let role = "pmo";
vi.mock("../../lib/auth", () => ({
  useAuth: () => ({ data: { role } }),
  isPmoOrAdmin: (r?: string) => r === "admin" || r === "pmo",
}));

const mutate = vi.fn();
let savedViewsData: SavedView[] = [];
vi.mock("../../lib/saved-views", () => ({
  useSavedViews: () => ({ data: savedViewsData }),
  useSaveViews: () => ({ mutate, isPending: false }),
}));

beforeEach(() => { role = "pmo"; mutate.mockReset(); savedViewsData = []; });

describe("ViewBuilder", () => {
  it("is hidden from non-PMO/admin", () => {
    role = "contributor";
    renderWithProviders(<ViewBuilder />);
    expect(screen.queryByText("Custom views")).not.toBeInTheDocument();
  });

  it("saves a named custom view with its entity, kind and filter", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "issue" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "board" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blocked issues" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    fireEvent.change(screen.getByLabelText("Filter field 1"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("Filter value 1"), { target: { value: "in_progress" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({
      name: "Blocked issues",
      entity: "issue",
      viewKind: "board",
      filters: [{ field: "status", value: "in_progress" }],
    });
  });

  it("saves a table view with the selected columns", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Task table" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "table" } });
    // The column checklist appears for table kind; pick two task columns.
    fireEvent.click(screen.getByLabelText("Column Status"));
    fireEvent.click(screen.getByLabelText("Column Assignee"));
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({ name: "Task table", viewKind: "table", columns: ["status", "assignee"] });
  });

  it("saves a timeline view with its date field", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Task timeline" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "timeline" } });
    fireEvent.change(screen.getByLabelText("Date field (timeline axis)"), { target: { value: "dueDate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({ name: "Task timeline", viewKind: "timeline", dateField: "dueDate" });
  });

  it("saves a chart view with its chart spec (bar count-by-field)", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tasks by priority" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "chart" } });
    fireEvent.change(screen.getByLabelText("Group by field"), { target: { value: "priority" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({ name: "Tasks by priority", viewKind: "chart", chart: { type: "bar", groupField: "priority" } });
  });

  it("won't save without a name", () => {
    renderWithProviders(<ViewBuilder />);
    // Save button is disabled with an empty name.
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();
  });

  it("lists the built-in views as read-only (not editable/deletable)", () => {
    renderWithProviders(<ViewBuilder />);
    const builtin = screen.getByTestId("builtin-views");
    // The task built-ins (List/Table/GTD Board/…) show with a read-only marker and no Delete button.
    expect(within(builtin).getByText("GTD Board")).toBeInTheDocument();
    expect(within(builtin).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("saves a gantt chart view with its start and end date fields", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Task gantt" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "chart" } });
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "gantt" } });
    // The gantt branch swaps the "group by" picker for start/end date-field pickers.
    fireEvent.change(screen.getByLabelText("Start date field"), { target: { value: "startDate" } });
    fireEvent.change(screen.getByLabelText("End date field"), { target: { value: "dueDate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({
      name: "Task gantt",
      viewKind: "chart",
      chart: { type: "gantt", startField: "startDate", endField: "dueDate" },
    });
  });

  it("carries the chosen sort (with direction) and group-by into the saved view", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sorted list" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "priority" } });
    // Direction is disabled until a sort field is picked; now it's enabled.
    const dir = screen.getByLabelText("Direction") as HTMLSelectElement;
    expect(dir).not.toBeDisabled();
    fireEvent.change(dir, { target: { value: "desc" } });
    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "status" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({ name: "Sorted list", sort: { field: "priority", dir: "desc" }, groupBy: "status" });
  });

  it("omits a filter row that has a field but no value", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "No filters" } });
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    // Field defaults to the first field but the value is left blank → the row is dropped on save.
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1) as Record<string, unknown>;
    expect(saved.filters).toBeUndefined();
  });

  it("lets you remove a filter row before saving", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
    expect(screen.getByLabelText("Filter field 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter 1" }));
    expect(screen.queryByLabelText("Filter field 1")).not.toBeInTheDocument();
  });

  it("toggling a table column on then off leaves it out of the saved view", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Empty cols" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "table" } });
    fireEvent.click(screen.getByLabelText("Column Status")); // on
    fireEvent.click(screen.getByLabelText("Column Status")); // off again
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1) as Record<string, unknown>;
    // None selected → the columns key is omitted (meaning "show every field").
    expect(saved.columns).toBeUndefined();
  });

  it("clears the form after a successful save", () => {
    mutate.mockImplementation((_views: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderWithProviders(<ViewBuilder />);
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Ephemeral" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    // reset() runs in onSuccess, blanking the name field.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("surfaces a destructive toast when the save fails", async () => {
    mutate.mockImplementation((_views: unknown, opts?: { onError?: (e: Error) => void }) =>
      opts?.onError?.(new Error("network down")),
    );
    renderWithProviders(<><ViewBuilder /><Toaster /></>);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Doomed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(await screen.findByText("COULDN'T SAVE")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
  });
});

describe("ViewBuilder — existing custom views", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists saved custom views and deletes one after confirmation", () => {
    savedViewsData = [{ id: "cv1", name: "My saved view", entity: "task", viewKind: "list", scope: "engine:task" }];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithProviders(<ViewBuilder />);
    expect(screen.getByText("My saved view")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalled();
    // The mutation is handed the list with the deleted view removed.
    expect(mutate).toHaveBeenCalledTimes(1);
    const nextList = mutate.mock.calls[0]![0] as SavedView[];
    expect(nextList.find((v) => v.id === "cv1")).toBeUndefined();
  });

  it("does not delete when the confirmation is dismissed", () => {
    savedViewsData = [{ id: "cv1", name: "Keep me", entity: "issue", viewKind: "board", scope: "engine:issue" }];
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWithProviders(<ViewBuilder />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("surfaces a destructive toast when a delete fails", async () => {
    savedViewsData = [{ id: "cv1", name: "Doomed view", entity: "task", viewKind: "list", scope: "engine:task" }];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mutate.mockImplementation((_views: unknown, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error("server error")));
    renderWithProviders(<><ViewBuilder /><Toaster /></>);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("COULDN'T DELETE")).toBeInTheDocument();
    expect(screen.getByText("server error")).toBeInTheDocument();
  });
});

describe("ViewBuilder — chart variants and entity switching", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves a pie chart view over the issue entity", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "issue" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Issue share" } });
    fireEvent.change(screen.getByLabelText("View kind"), { target: { value: "chart" } });
    fireEvent.change(screen.getByLabelText("Chart type"), { target: { value: "pie" } });
    fireEvent.change(screen.getByLabelText("Group by field"), { target: { value: "status" } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    const saved = (mutate.mock.calls[0]![0] as unknown[]).at(-1);
    expect(saved).toMatchObject({ entity: "issue", viewKind: "chart", chart: { type: "pie", groupField: "status" } });
  });

  it("resets slicing fields when the entity is switched", () => {
    renderWithProviders(<ViewBuilder />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Switcher" } });
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "priority" } });
    expect(screen.getByLabelText("Sort by")).toHaveValue("priority");
    // Switching entity clears the sort selection.
    fireEvent.change(screen.getByLabelText("Entity"), { target: { value: "issue" } });
    expect(screen.getByLabelText("Sort by")).toHaveValue("");
  });
});
