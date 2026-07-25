import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/utils";
import { Toaster } from "../ui/toaster";
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
// Partial mock — keep every real export (query-key helpers the mover/invalidation use) and only
// stub the data/update hooks, so the engine wiring is exercised without a backend.
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetProjectIssues: () => ({ data: ISSUES, isLoading: false, error: null, refetch: vi.fn() }),
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
    // Column labels come LIVE from the resolved vocabulary (org owns the casing) — the compiled
    // default is natural-case ("Todo" / "In progress"); the board renders them uppercased in CSS.
    const todo = screen.getByLabelText("Todo");
    expect(within(todo).getByText("Wire the webhook")).toBeInTheDocument();
    const inProgress = screen.getByLabelText("In progress");
    expect(within(inProgress).getByText("Fix the flake")).toBeInTheDocument();
  });

  it("moving a card via its selector updates the issue status with the version token", () => {
    mutate.mockClear();
    renderWithProviders(<IssueEngineView projectId="p1" />);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    fireEvent.change(screen.getByLabelText("Move Wire the webhook"), { target: { value: "done" } });
    // The issue mover now passes a second arg (onSuccess/onError callbacks for the optimistic
    // move + undo/conflict handling), so assert on the first (payload) arg specifically.
    expect(mutate).toHaveBeenCalled();
    expect(mutate.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ projectId: "p1", issueId: "issue-aaaa1111", data: expect.objectContaining({ status: "done" }) }),
    );
  });

  // The optimistic-move / undo / 409-conflict semantics the bespoke AgileBoard used to own now live
  // in the issue descriptor's mover; assert them through the generic engine so the behaviour the
  // retired board tested is still covered.
  it("toasts ISSUE MOVED with an Undo that re-issues the inverse move on a successful move", async () => {
    mutate.mockReset();
    mutate.mockImplementation((_payload: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
    renderWithProviders(<><IssueEngineView projectId="p1" /><Toaster /></>);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    fireEvent.change(screen.getByLabelText("Move Wire the webhook"), { target: { value: "done" } });

    expect(await screen.findByText("ISSUE MOVED")).toBeInTheDocument();
    // Undo re-issues the move back to the original status (todo).
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("MOVE UNDONE")).toBeInTheDocument();
    const undoCall = mutate.mock.calls.at(-1)!;
    expect(undoCall[0]).toEqual(expect.objectContaining({ issueId: "issue-aaaa1111", data: expect.objectContaining({ status: "todo" }) }));
  });

  it("shows an EDIT CONFLICT toast (not a generic error) when the move comes back 409", async () => {
    mutate.mockReset();
    mutate.mockImplementation((_payload: unknown, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.({ status: 409 }));
    renderWithProviders(<><IssueEngineView projectId="p1" /><Toaster /></>);
    fireEvent.click(screen.getByRole("tab", { name: "Board" }));
    fireEvent.change(screen.getByLabelText("Move Wire the webhook"), { target: { value: "done" } });

    expect(await screen.findByText("EDIT CONFLICT")).toBeInTheDocument();
  });
});
