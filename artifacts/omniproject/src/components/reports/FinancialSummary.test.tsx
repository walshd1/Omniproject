import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { FinancialSummary } from "./FinancialSummary";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("FinancialSummary", () => {
  it("rolls up budget vs actual with variance and % consumed", () => {
    renderWithProviders(<FinancialSummary projectId="p1" />, {
      client: seed([
        issue({ id: "a", budget: 45000, actualCost: 28000 }),
        issue({ id: "b", budget: 30000, actualCost: 6000 }),
      ]),
    });
    expect(screen.getByTestId("financial-summary")).toBeInTheDocument();
    expect(screen.getByText("45% consumed")).toBeInTheDocument(); // 34000 / 75000
    expect(screen.getByText("under budget")).toBeInTheDocument();
  });
  it("shows the empty state when no item carries a budget or actual", () => {
    renderWithProviders(<FinancialSummary projectId="p1" />, { client: seed([issue({ id: "a" })]) });
    expect(screen.getByTestId("financial-summary-empty")).toBeInTheDocument();
  });
});
