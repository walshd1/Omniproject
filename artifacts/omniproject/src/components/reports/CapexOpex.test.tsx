import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { CapexOpex } from "./CapexOpex";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("CapexOpex", () => {
  it("renders the CapEx/OpEx split and per-item rows from financial fields", () => {
    renderWithProviders(<CapexOpex projectId="p1" />, {
      client: seed([
        issue({ id: "a", title: "Auth", capexAmount: 30000, opexAmount: 15000, costCategory: "Software", depreciationMonths: 36 }),
        issue({ id: "b", title: "Sync", expenditureType: "opex", actualCost: 30000, costCategory: "Integration" }),
      ]),
    });
    expect(screen.getByTestId("capex-opex")).toBeInTheDocument();
    expect(screen.getByTestId("capex-row-a")).toHaveTextContent("Software");
    expect(screen.getByTestId("capex-row-b")).toHaveTextContent("Integration");
    // CapEx share = 30000 / (45000 + 30000) = 40%
    expect(screen.getByText("40% of spend")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is classified as capex/opex", () => {
    renderWithProviders(<CapexOpex projectId="p1" />, {
      client: seed([issue({ id: "a", title: "Plain", budget: 1000 })]),
    });
    expect(screen.getByTestId("capex-empty")).toBeInTheDocument();
  });
});
