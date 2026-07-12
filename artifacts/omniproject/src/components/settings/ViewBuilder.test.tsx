import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { ViewBuilder } from "./ViewBuilder";

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
vi.mock("../../lib/saved-views", () => ({
  useSavedViews: () => ({ data: [] }),
  useSaveViews: () => ({ mutate, isPending: false }),
}));

beforeEach(() => { role = "pmo"; mutate.mockClear(); });

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
});
