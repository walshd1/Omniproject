import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { IncomeInvoicing } from "./IncomeInvoicing";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...over } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

describe("IncomeInvoicing", () => {
  it("shows projected vs invoiced with the unbilled gap and PO refs", () => {
    renderWithProviders(<IncomeInvoicing projectId="p1" />, {
      client: seed([
        issue({ id: "a", revenue: 90000, invoicedAmount: 50000, purchaseOrder: "PO-2026-001" }),
        issue({ id: "b", revenue: 10000, invoicedAmount: 10000 }),
      ]),
    });
    expect(screen.getByTestId("income-invoicing")).toBeInTheDocument();
    expect(screen.getByTestId("income-row-a")).toHaveTextContent("PO-2026-001");
    expect(screen.getByText("60% billed")).toBeInTheDocument(); // 60000 / 100000
  });

  it("shows the empty state when no item carries income", () => {
    renderWithProviders(<IncomeInvoicing projectId="p1" />, { client: seed([issue({ id: "a" })]) });
    expect(screen.getByTestId("income-empty")).toBeInTheDocument();
  });
});
