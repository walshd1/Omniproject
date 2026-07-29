import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { FinancialStatements } from "./FinancialStatements";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("FinancialStatements", () => {
  it("rolls up the consolidated P&L + receivables from the money fields", () => {
    renderWithProviders(<FinancialStatements projectId="p1" />, {
      client: seed([
        issue({ id: "a", revenue: 1000, actualCost: 600, invoicedAmount: 400 }),
        issue({ id: "b", revenue: 500, actualCost: 200, invoicedAmount: 500 }),
      ]),
    });
    expect(screen.getByTestId("financial-statements")).toBeInTheDocument();
    expect(screen.getByTestId("pnl-Gross profit")).toHaveTextContent("Gross profit");
  });

  it("shows the empty state when no item carries finance data", () => {
    renderWithProviders(<FinancialStatements projectId="p1" />, { client: seed([issue({ id: "a" })]) });
    expect(screen.getByTestId("statements-empty")).toBeInTheDocument();
  });
});
