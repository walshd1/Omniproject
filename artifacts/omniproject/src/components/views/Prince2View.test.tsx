import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  getGetProjectIssuesQueryKey,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { Prince2View } from "./Prince2View";

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

// backlog/todo → Initiation, in_progress/in_review → Delivery, done → Closure.
const ISSUES: Issue[] = [
  issue({ id: "a", title: "Charter", status: "todo" }),
  issue({ id: "b", title: "Build module", status: "in_progress" }),
  issue({ id: "c", title: "Final handover", status: "done" }),
  issue({ id: "d", title: "Late deliverable", status: "in_progress", dueDate: "2000-01-01" }),
];

describe("Prince2View", () => {
  it("renders the highlight report with delivered/total and completion", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Highlight Report")).toBeInTheDocument();
    expect(screen.getByText("Products delivered")).toBeInTheDocument();
    // 1 of 4 done.
    expect(screen.getByText("1/4")).toBeInTheDocument();
    expect(screen.getByText("Completion")).toBeInTheDocument();
  });

  it("groups products into management stages", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Stage · Initiation")).toBeInTheDocument();
    expect(screen.getByText("Stage · Delivery")).toBeInTheDocument();
    expect(screen.getByText("Stage · Closure")).toBeInTheDocument();
    expect(screen.getByText("Charter")).toBeInTheDocument();
    expect(screen.getByText("Build module")).toBeInTheDocument();
  });

  it("raises a tolerance-breach banner when there are overdue exceptions", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });

    expect(screen.getByText(/Tolerance breach/i)).toBeInTheDocument();
  });

  it("opens the issue dialog when a product is clicked", async () => {
    const user = userEvent.setup();
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), ISSUES);
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });

    await user.click(screen.getByText("Charter"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("renders no stages but still a highlight report when there are no issues", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), []);
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Highlight Report")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
    expect(screen.queryByText(/^Stage · /)).not.toBeInTheDocument();
  });

  it("renders an error alert with retry when issues fail to load", async () => {
    const qc = makeClient();
    renderWithProviders(<Prince2View projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
