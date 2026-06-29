import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { MonteCarloRisk } from "./MonteCarloRisk";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i1", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", version: 1, estimateHours: 40, ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("MonteCarloRisk", () => {
  it("renders the simulation (percentiles + plan confidence) from the project's estimates", () => {
    renderWithProviders(<MonteCarloRisk projectId="p1" />, {
      client: seed([issue({ id: "a", estimateHours: 100 }), issue({ id: "b", estimateHours: 40 }), issue({ id: "c", estimateHours: 20 })]),
    });
    expect(screen.getByTestId("monte-carlo")).toBeInTheDocument();
    expect(screen.getByText(/P80 \(commit\)/i)).toBeInTheDocument();
    expect(screen.getByText(/P90 \(safe\)/i)).toBeInTheDocument();
    // The plan total (sum of estimates) is shown.
    expect(screen.getByText("160")).toBeInTheDocument();
    // The takeaway sentence references P80.
    expect(screen.getByText(/commit to the/i)).toBeInTheDocument();
  });

  it("excludes done items and shows an empty state when nothing is estimable", () => {
    renderWithProviders(<MonteCarloRisk projectId="p1" />, {
      client: seed([issue({ id: "a", status: "done", estimateHours: 100 }), issue({ id: "b", estimateHours: 0 })]),
    });
    expect(screen.getByTestId("mc-empty")).toBeInTheDocument();
  });
});
