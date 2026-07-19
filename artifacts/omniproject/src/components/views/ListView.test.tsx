import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getGetProjectIssuesQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ListView } from "./ListView";

const PROJECT = "proj-1";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

function issue(p: Partial<Issue>): Issue {
  return {
    id: "i1",
    projectId: PROJECT,
    title: "Issue",
    status: "todo",
    priority: "medium",
    labels: [],
    source: "demo",
    ...p,
  } as Issue;
}

const ISSUES: Issue[] = [
  issue({ id: "a", title: "Alpha task", status: "in_progress", priority: "high", assignee: "Ada", dueDate: "2030-01-01" }),
  issue({ id: "b", title: "Bravo task", status: "done", priority: "low" }),
];

describe("ListView", () => {
  it("renders a sortable table row per issue", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.getByText("Bravo task")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // Status/priority labels.
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Title/i })).toBeInTheDocument();
  });

  it("shows the empty-state row when there are no work items", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), []);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("No work items.")).toBeInTheDocument();
  });

  it("toggles sort direction via the column header button", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    const titleBtn = screen.getByRole("button", { name: /Title/i });
    await user.click(titleBtn);
    // Clicking sets ascending sort on title.
    expect(screen.getByRole("columnheader", { name: /Title/i })).toHaveAttribute("aria-sort", "ascending");
    await user.click(screen.getByRole("button", { name: /Title/i }));
    expect(screen.getByRole("columnheader", { name: /Title/i })).toHaveAttribute("aria-sort", "descending");
  });

  it("opens the issue dialog when a row is clicked", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    await user.click(screen.getByRole("button", { name: /Open work item: Alpha task/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("renders an error alert with retry when issues fail to load", async () => {
    const qc = makeClient();
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("sorts by each column key without error (priority, assignee, due, status)", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    // Each header click routes through a different `rank()` branch; assert the active sort indicator moves.
    for (const name of [/Priority/i, /Assignee/i, /Due/i, /Status/i]) {
      await user.click(screen.getByRole("button", { name }));
      expect(screen.getByRole("columnheader", { name })).toHaveAttribute("aria-sort", "ascending");
    }
    // Both rows still present after re-sorting.
    expect(screen.getByText("Alpha task")).toBeInTheDocument();
    expect(screen.getByText("Bravo task")).toBeInTheDocument();
  });

  it("opens the dialog when a focused row is activated with Enter (keyboard access)", async () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });

    fireEvent.keyDown(screen.getByRole("button", { name: /Open work item: Alpha task/i }), { key: "Enter" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("flags an overdue, not-done item's due date in red", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), [
      issue({ id: "late", title: "Overdue item", status: "in_progress", dueDate: "2000-01-01" }),
    ]);
    renderWithProviders(<ListView projectId={PROJECT} />, { client: qc });
    const dueCell = screen.getByText("2000-01-01");
    expect(dueCell.className).toMatch(/text-red-500/);
  });
});
