import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectFinancialsQueryKey, getGetFxRatesQueryKey, getGetSettingsQueryKey, type Project, type ProjectFinancials, type FxRates, type Settings } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioFinancials } from "./PortfolioFinancials";

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "P1", source: "jira", ...over } as Project;
}
function fin(over: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return { currency: "GBP", budgetAllocated: 1000, actualBurn: 400, earnedValue: 400, cpi: 1, spi: 1, financialHealth: "green", forecastCostAtCompletion: 1000, ...over } as ProjectFinancials;
}
const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, JPY: 0.005 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;

function seed(projects: Project[], financials: Record<string, ProjectFinancials>, settings?: Partial<Settings>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  qc.setQueryData(getGetSettingsQueryKey(), { aiProvider: "none", backendSource: "all", ...settings } as Settings);
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

  it("shows a local-currency figure alongside a single-currency programme's consolidated total", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(
        [
          project({ id: "a", programmeId: "jp", programmeName: "Japan" }),
          project({ id: "b", programmeId: "jp", programmeName: "Japan" }),
        ],
        {
          a: fin({ currency: "JPY", budgetAllocated: 500000, forecastCostAtCompletion: 500000 }),
          b: fin({ currency: "JPY", budgetAllocated: 300000, forecastCostAtCompletion: 300000 }),
        },
        { reportingCurrency: "GBP" },
      ),
    });
    const local = screen.getByTestId("portfolio-fin-row-jp-local");
    expect(local).toHaveTextContent("local budget");
  });

  it("does not show a local-currency line once a programme mixes currencies", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(
        [
          project({ id: "a", programmeId: "mixed", programmeName: "Mixed" }),
          project({ id: "b", programmeId: "mixed", programmeName: "Mixed" }),
        ],
        { a: fin({ currency: "GBP" }), b: fin({ currency: "USD" }) },
        { reportingCurrency: "GBP" },
      ),
    });
    expect(screen.queryByTestId("portfolio-fin-row-mixed-local")).not.toBeInTheDocument();
  });
});
