import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { SprintReview } from "./SprintReview";

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

describe("SprintReview", () => {
  it("rolls a sprint's committed and completed points", () => {
    renderWithProviders(<SprintReview projectId="p1" />, {
      client: seed([
        issue({ id: "s1", sprint: "S-24", status: "done", storyPoints: 3 }),
        issue({ id: "s2", sprint: "S-24", status: "in_progress", storyPoints: 5 }),
      ]),
    });
    expect(screen.getByTestId("sprint-review")).toBeInTheDocument();
    const row = screen.getByTestId("sprint-row-S-24");
    // committed 8 points, completed 3 of them → 38% completion
    expect(row).toHaveTextContent("8");
    expect(row).toHaveTextContent("3");
    expect(row).toHaveTextContent("38%");
  });

  it("shows the empty state with no sprinted items", () => {
    renderWithProviders(<SprintReview projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("sprint-review-empty")).toBeInTheDocument();
  });
});
