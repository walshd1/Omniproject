import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { getGetProjectFinancialsQueryKey, getGetProjectIssuesQueryKey, type ProjectFinancials, type Issue } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ForecastWindows } from "./ForecastWindows";

const PROJECT = "proj-1";
const NOW = Date.parse("2026-03-15");

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
}

const FIN: ProjectFinancials = {
  currency: "GBP", budgetAllocated: 120000, actualBurn: 50000, earnedValue: 48000,
  cpi: 0.96, spi: 1, financialHealth: "AMBER", forecastCostAtCompletion: 150000, provenance: "sourced",
};

function issue(over: Partial<Issue>): Issue {
  return { id: "i", projectId: PROJECT, title: "T", status: "todo", priority: "high", labels: [], source: "jira", ...over } as Issue;
}

function seed(fin: ProjectFinancials | undefined, issues: Issue[]) {
  const qc = client();
  if (fin) qc.setQueryData(getGetProjectFinancialsQueryKey(PROJECT), fin);
  qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT), issues);
  return qc;
}

describe("ForecastWindows", () => {
  const dated = [issue({ startDate: "2026-01-01", dueDate: "2026-06-30" })];

  it("renders the time-phased forecast with BAC/EAC/VAC stats", () => {
    renderWithProviders(<ForecastWindows projectId={PROJECT} now={NOW} />, { client: seed(FIN, dated) });
    expect(screen.getByTestId("forecast-windows")).toBeInTheDocument();
    expect(screen.getByText("Budget (BAC)")).toBeInTheDocument();
    expect(screen.getByText("Forecast (EAC)")).toBeInTheDocument();
    expect(screen.getByText("Variance (VAC)")).toBeInTheDocument();
    expect(screen.getByText("projected overspend")).toBeInTheDocument(); // EAC 150k > BAC 120k
  });

  it("lets the user switch the spreading profile", () => {
    renderWithProviders(<ForecastWindows projectId={PROJECT} now={NOW} />, { client: seed(FIN, dated) });
    expect((screen.getByLabelText("Spreading profile") as HTMLSelectElement).value).toBe("scurve");
  });

  it("shows the empty state when work items carry no dates", () => {
    renderWithProviders(<ForecastWindows projectId={PROJECT} now={NOW} />, { client: seed(FIN, [issue({})]) });
    expect(screen.getByTestId("forecast-empty")).toBeInTheDocument();
  });

  it("shows the empty state when there is no budget", () => {
    renderWithProviders(<ForecastWindows projectId={PROJECT} now={NOW} />, { client: seed({ ...FIN, budgetAllocated: undefined } as unknown as ProjectFinancials, dated) });
    expect(screen.getByTestId("forecast-empty")).toBeInTheDocument();
  });
});
