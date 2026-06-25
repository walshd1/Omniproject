import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
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

function seeded(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
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
