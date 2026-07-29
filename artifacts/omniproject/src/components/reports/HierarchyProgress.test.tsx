import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { HierarchyProgress } from "./HierarchyProgress";

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i", projectId: "p1", title: "T", status: "todo", priority: "medium", labels: [], source: "jira",
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
  } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

afterEach(() => resetFetchMock());

describe("HierarchyProgress", () => {
  it("rolls an epic's progress up from its children", () => {
    renderWithProviders(<HierarchyProgress projectId="p1" />, {
      client: seed([
        issue({ id: "epic", status: "in_progress" }),
        issue({ id: "s1", epic: "epic", status: "done" }),
        issue({ id: "s2", epic: "epic", status: "todo" }),
      ]),
    });
    expect(screen.getByTestId("hierarchy-progress")).toBeInTheDocument();
    // epic + both children render as nodes; epic rolls to 50% (one of two children done)
    expect(screen.getByTestId("hierarchy-node-epic")).toHaveTextContent("50%");
    expect(screen.getByTestId("hierarchy-node-s1")).toBeInTheDocument();
    expect(screen.getByTestId("hierarchy-node-s2")).toBeInTheDocument();
  });

  it("shows the empty state with no work items", () => {
    renderWithProviders(<HierarchyProgress projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("hierarchy-empty")).toBeInTheDocument();
  });
});
