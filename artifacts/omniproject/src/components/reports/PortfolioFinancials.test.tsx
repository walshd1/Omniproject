import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectFinancialsQueryKey, getGetFxRatesQueryKey, type Project, type ProjectFinancials, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioFinancials } from "./PortfolioFinancials";

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "P1", source: "jira", ...over } as Project;
}
function fin(over: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return { currency: "GBP", budgetAllocated: 1000, actualBurn: 400, earnedValue: 400, cpi: 1, spi: 1, financialHealth: "green", forecastCostAtCompletion: 1000, ...over } as ProjectFinancials;
}
const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;

function seed(projects: Project[], financials: Record<string, ProjectFinancials>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, f] of Object.entries(financials)) qc.setQueryData(getGetProjectFinancialsQueryKey(id), f);
  return qc;
}

describe("PortfolioFinancials", () => {
  it("consolidates budget/actual/forecast by programme into the reporting currency", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(
        [
          project({ id: "a", programmeId: "p1", programmeName: "Platform" }),
          project({ id: "b", programmeId: "p1", programmeName: "Platform" }),
        ],
        { a: fin({ budgetAllocated: 1000, forecastCostAtCompletion: 1100 }), b: fin({ budgetAllocated: 500, forecastCostAtCompletion: 500 }) },
      ),
    });
    expect(screen.getByTestId("portfolio-financials")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-fin-row-p1")).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects to consolidate", () => {
    renderWithProviders(<PortfolioFinancials />, { client: seed([], {}) });
    expect(screen.getByTestId("portfolio-fin-empty")).toBeInTheDocument();
  });
});
