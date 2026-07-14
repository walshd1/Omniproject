import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("renders headline totals and dashes an item with no opex/annual charge", () => {
    renderWithProviders(<CapexOpex projectId="p1" />, {
      client: seed([
        // Capex-only, no depreciation period → opex and annual-charge cells collapse to "—".
        issue({ id: "c", title: "Licences", capexAmount: 20000, costCategory: "Software" }),
      ]),
    });
    expect(screen.getByText("Capital (CapEx)")).toBeInTheDocument();
    expect(screen.getByText("Operating (OpEx)")).toBeInTheDocument();
    expect(screen.getByText("Annual capital charge")).toBeInTheDocument();
    const row = screen.getByTestId("capex-row-c");
    // capex present, opex + annual charge dashed.
    expect(row).toHaveTextContent("Software");
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an error with a retry control when the issues query fails", async () => {
    // Nothing seeded → the money hook's issues fetch fails in jsdom, driving the error surface.
    renderWithProviders(<CapexOpex projectId="p1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry); // exercises DataState onRetry → refetch()
    expect(retry).toBeInTheDocument();
  });
});
