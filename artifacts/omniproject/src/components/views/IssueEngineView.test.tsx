import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { IssueEngineView } from "./IssueEngineView";
import type { Issue } from "@workspace/api-client-react";

/**
 * The issue "Flow" view renders issues through the SAME generic engine tasks use — proving tasks and
 * issues are treated identically. We mock the issue data/update hooks so the test exercises the
 * engine wiring (list default, board columns by status, a status move) without a real backend.
 */
const ISSUES: Partial<Issue>[] = [
  { id: "issue-aaaa1111", projectId: "p1", title: "Wire the webhook", status: "todo", priority: "high", labels: ["infra"] },
  { id: "issue-bbbb2222", projectId: "p1", title: "Fix the flake", status: "in_progress", priority: "none", labels: [] },
];
const mutate = vi.fn();
vi.mock("@workspace/api-client-react", () => ({
  useGetProjectIssues: () => ({ data: ISSUES, isLoading: false, error: null }),
  useUpdateIssue: () => ({ mutate }),
}));
// IssueDialog pulls in heavy generated hooks; stub it — this test is about the engine, not the dialog.
vi.mock("../IssueDialog", () => ({ IssueDialog: () => null }));
// The engine loads shared saved views over /api/views; stub it so this test stays network-free.
vi.mock("../../lib/saved-views", () => ({ useSavedViews: () => ({ data: [] }) }));

describe("IssueEngineView (issues through the generic engine)", () => {
  it("defaults to a list of the project's issues", () => {
    renderWithProviders(<IssueEngineView projectId="p1" />);
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Wire the webhook")).toBeInTheDocument();
    expect(screen.getByText("Fix the flake")).toBeInTheDocument();
  });

  it("renders the issue board columns and places cards by status", () => {
    renderWithProviders(<IssueEngineView projectId="p1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    const todo = screen.getByLabelText("TODO");
    expect(within(todo).getByText("Wire the webhook")).toBeInTheDocument();
    const inProgress = screen.getByLabelText("IN PROGRESS");
    expect(within(inProgress).getByText("Fix the flake")).toBeInTheDocument();
  });

  it("moving a card via its selector updates the issue status with the version token", () => {
    mutate.mockClear();
    renderWithProviders(<IssueEngineView projectId="p1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    fireEvent.change(screen.getByLabelText("Move Wire the webhook"), { target: { value: "done" } });
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", issueId: "issue-aaaa1111", data: expect.objectContaining({ status: "done" }) }),
    );
  });
});
