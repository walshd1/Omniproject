import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getGetProjectIssuesQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ScrumView } from "./ScrumView";

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

// inActiveSprint = todo/in_progress/in_review; backlog (non-cancelled) → backlog list.
const ISSUES: Issue[] = [
  issue({ id: "a", title: "Sprint todo", status: "todo", labels: ["sp:3"] }),
  issue({ id: "b", title: "Sprint doing", status: "in_progress", labels: ["sp:5"] }),
  issue({ id: "c", title: "Sprint done", status: "done", labels: ["sp:2"] }),
  issue({ id: "d", title: "Backlog item", status: "backlog", labels: ["sp:8"] }),
];

describe("ScrumView", () => {
  it("computes sprint metrics from story points", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ScrumView projectId={PROJECT} />, { client: qc });

    // inActiveSprint = todo/in_progress/in_review only (done is NOT in sprint).
    // committed = 3 (todo) + 5 (in_progress) = 8; completed = 0; remaining = 8.
    const committed = screen.getByText("Committed (pts)").parentElement!;
    expect(within(committed).getByText("8")).toBeInTheDocument();
    const remaining = screen.getByText("Remaining").parentElement!;
    expect(within(remaining).getByText("8")).toBeInTheDocument();
    const completed = screen.getByText("Completed (pts)").parentElement!;
    expect(within(completed).getByText("0")).toBeInTheDocument();
  });

  it("places issues on the sprint board and backlog", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ScrumView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Sprint todo")).toBeInTheDocument();
    expect(screen.getByText("Sprint doing")).toBeInTheDocument();
    expect(screen.getByText("PRODUCT BACKLOG")).toBeInTheDocument();
    expect(screen.getByText("Backlog item")).toBeInTheDocument();
  });

  it("opens the issue dialog when a card is clicked", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<ScrumView projectId={PROJECT} />, { client: qc });

    await user.click(screen.getByText("Sprint todo"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("renders empty columns/backlog placeholders when there are no issues", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), []);
    renderWithProviders(<ScrumView projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("PRODUCT BACKLOG")).toBeInTheDocument();
    expect(screen.getAllByText("Empty").length).toBeGreaterThan(0);
  });

  it("renders an error alert with retry when issues fail to load", async () => {
    const qc = makeClient();
    renderWithProviders(<ScrumView projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
