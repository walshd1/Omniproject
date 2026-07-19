import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { AgileBoard } from "./AgileBoard";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "iss-0001",
    projectId: "proj-1",
    title: "Untitled",
    status: "todo",
    priority: "none",
    labels: [],
    source: "jira",
    ...over,
  } as Issue;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function seeded(issues: Issue[]): QueryClient {
  const qc = freshClient();
  qc.setQueryData(getGetProjectIssuesQueryKey("proj-1"), issues);
  return qc;
}

describe("AgileBoard", () => {
  it("renders the conventional columns and the issue cards", () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, {
      client: seeded([issue({ id: "iss-1", title: "Build the thing", status: "in_progress" })]),
    });
    expect(screen.getByText("Build the thing")).toBeInTheDocument();
    // Conventional buckets are always present as columns.
    expect(screen.getByTestId("column-backlog")).toBeInTheDocument();
    expect(screen.getByTestId("column-done")).toBeInTheDocument();
  });

  it("derives a column for a non-conventional backend status (backend-agnostic)", () => {
    // A backend may emit its own status; the board must not silently drop it.
    renderWithProviders(<AgileBoard projectId="proj-1" />, {
      client: seeded([issue({ id: "iss-9", title: "Escalated item", status: "awaiting_triage" })]),
    });
    expect(screen.getByTestId("column-awaiting_triage")).toBeInTheDocument();
    expect(screen.getByText("Escalated item")).toBeInTheDocument();
  });

  it("renders the conventional columns even with zero issues (empty, not broken)", () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([]) });
    expect(screen.getByTestId("column-todo")).toBeInTheDocument();
    expect(screen.getByTestId("column-done")).toBeInTheDocument();
  });
});

/**
 * Loading/error data states, opening the create/edit dialog, and the drag-and-drop move
 * (optimistic update, undo, and rollback-on-error) — none of the tests above ever click a
 * card, drag one, or let the issues query fail, so this is genuinely new coverage.
 */
describe("AgileBoard interactions", () => {
  const inProgressIssue = issue({ id: "iss-1", title: "Build the thing", status: "in_progress" });

  // A drag operation's payload must be the SAME object across dragStart/drop — a real browser
  // DataTransfer persists for one drag gesture; this stands in for that.
  function makeDataTransfer() {
    let stored = "";
    return {
      setData: (_type: string, value: string) => { stored = value; },
      getData: () => stored,
    };
  }

  // Drags iss-1 from its seeded column onto "done". Shared by the success/failure move tests,
  // which only differ in the routes they've configured beforehand.
  function dragIssueToDone() {
    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getByTestId("issue-card-iss-1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("column-done"), { dataTransfer: dt });
  }

  afterEach(() => vi.restoreAllMocks());

  it("shows a loading skeleton (one per conventional column) before issues have loaded", () => {
    const { container } = renderWithProviders(<AgileBoard projectId="proj-1" />, { client: freshClient() });
    expect(screen.queryByTestId("column-todo")).toBeNull();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows an error state when the issues fetch fails, and retries on click", async () => {
    const calls = mockFetchRouter({ "/api/projects/proj-1/issues": { ok: false, status: 500 } });
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: freshClient() });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
    const before = calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(calls.length).toBeGreaterThan(before);
  });

  it("opens the create-issue dialog with the clicked column's status pre-selected", async () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([]) });
    fireEvent.click(screen.getByRole("button", { name: "New issue in In review" }));
    expect(await screen.findByText("NEW ISSUE")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveTextContent("IN REVIEW");
  });

  it("opens the edit-issue dialog pre-filled when a card is clicked", async () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([inProgressIssue]) });
    fireEvent.click(screen.getByTestId("issue-card-iss-1"));
    expect(await screen.findByText("EDIT ISSUE")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Build the thing")).toBeInTheDocument();
  });

  it("moves an issue via drag-and-drop, optimistically updates, and offers an Undo action", async () => {
    // The invalidateQueries() in moveIssue's onSuccess refetches this list; the response
    // reflects what a real backend would confirm — the issue now in its new column — so the
    // refetch doesn't clobber the optimistic update back to the pre-move status.
    const calls = mockFetchRouter({
      "/api/projects/proj-1/issues": { ok: true, body: [issue({ id: "iss-1", title: "Build the thing", status: "done" })] },
    });
    renderWithProviders(<><AgileBoard projectId="proj-1" /><Toaster /></>, { client: seeded([inProgressIssue]) });
    dragIssueToDone();

    // Optimistic: the card lands in its new column before any network response settles.
    await waitFor(() => expect(screen.getByTestId("column-done")).toHaveTextContent("Build the thing"));
    expect(await screen.findByText("ISSUE MOVED")).toBeInTheDocument();
    const patchCall = calls.find((c) => c.init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(String(patchCall!.init!.body));
    expect(body.status).toBe("done");

    // Undo re-issues the inverse move.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("MOVE UNDONE")).toBeInTheDocument();
  });

  it("rolls the card back and shows an error toast when the move fails", async () => {
    mockFetchRouter({
      "/api/projects/proj-1/issues": { ok: true, body: [inProgressIssue] },
      "/api/projects/proj-1/issues/iss-1": { ok: false, status: 500 },
    });
    renderWithProviders(<><AgileBoard projectId="proj-1" /><Toaster /></>, { client: seeded([inProgressIssue]) });
    dragIssueToDone();

    expect(await screen.findByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("Failed to move issue.")).toBeInTheDocument();
    // Rolled back to its original column.
    expect(screen.getByTestId("column-in_progress")).toHaveTextContent("Build the thing");
    expect(screen.getByTestId("column-done")).not.toHaveTextContent("Build the thing");
  });

  it("shows an EDIT CONFLICT toast (not a generic error) when the move comes back 409", async () => {
    mockFetchRouter({
      "/api/projects/proj-1/issues": { ok: true, body: [inProgressIssue] },
      "/api/projects/proj-1/issues/iss-1": { ok: false, status: 409 },
    });
    renderWithProviders(<><AgileBoard projectId="proj-1" /><Toaster /></>, { client: seeded([inProgressIssue]) });
    dragIssueToDone();

    expect(await screen.findByText("EDIT CONFLICT")).toBeInTheDocument();
    expect(screen.getByText(/refreshed instead of overwriting/i)).toBeInTheDocument();
  });

  it("opens the edit dialog when a card is focused and Enter is pressed (keyboard access)", async () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([inProgressIssue]) });
    fireEvent.keyDown(screen.getByTestId("issue-card-iss-1"), { key: "Enter" });
    expect(await screen.findByText("EDIT ISSUE")).toBeInTheDocument();
  });

  it("renders a card's labels and an assignee avatar initial", () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, {
      client: seeded([issue({ id: "iss-2", title: "Tagged", status: "todo", labels: ["bug", "ui"], assignee: "grace" })]),
    });
    expect(screen.getByText("bug")).toBeInTheDocument();
    expect(screen.getByText("ui")).toBeInTheDocument();
    // Assignee avatar shows the uppercased first initial.
    expect(screen.getByTitle("grace")).toHaveTextContent("G");
  });

  it("dropping a card back onto its own column is a no-op (no move, no toast)", () => {
    const calls = mockFetchRouter({ "/api/projects/proj-1/issues": { ok: true, body: [inProgressIssue] } });
    renderWithProviders(<><AgileBoard projectId="proj-1" /><Toaster /></>, { client: seeded([inProgressIssue]) });
    const dt = makeDataTransfer();
    fireEvent.dragStart(screen.getByTestId("issue-card-iss-1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("column-in_progress"), { dataTransfer: dt });
    // Same status → moveIssue returns early; nothing is PATCHed.
    expect(calls.some((c) => c.init?.method === "PATCH")).toBe(false);
  });

  it("highlights a column while a card is dragged over it and clears on leave", () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([inProgressIssue]) });
    const column = screen.getByTestId("column-done");
    fireEvent.dragOver(column);
    expect(column.className).toMatch(/border-primary/);
    fireEvent.dragLeave(column);
    expect(column.className).not.toMatch(/border-primary/);
  });

  it("opens the create dialog from the empty-column '+ Add' button", async () => {
    renderWithProviders(<AgileBoard projectId="proj-1" />, { client: seeded([]) });
    // With no issues every column is empty, so each renders the dashed "+ Add" affordance.
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add" })[0]!);
    expect(await screen.findByText("NEW ISSUE")).toBeInTheDocument();
  });
});
