import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioBenefits } from "./PortfolioBenefits";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, EUR: 1.1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
const issue = (o: Partial<Issue> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("PortfolioBenefits", () => {
  it("rolls planned vs realised benefit up by programme", () => {
    renderWithProviders(<PortfolioBenefits />, {
      client: seed([project({ id: "a", programmeId: "p1", programmeName: "Platform" })], { a: [issue({ id: "1", plannedBenefitValue: 100, actualBenefitValue: 25, benefitConfidence: 100 })] }),
    });
    expect(screen.getByTestId("portfolio-benefits")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-benefits-row-p1")).toHaveTextContent("25%");
  });

  it("shows the empty state when no project reports benefits", () => {
    renderWithProviders(<PortfolioBenefits />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1" })] }) });
    expect(screen.getByTestId("portfolio-benefits-empty")).toBeInTheDocument();
  });

  it("shows a local-currency figure for a single-currency programme", () => {
    renderWithProviders(<PortfolioBenefits />, {
      client: seed(
        [project({ id: "a", programmeId: "eu", programmeName: "EU" })],
        { a: [issue({ id: "1", currency: "EUR", plannedBenefitValue: 100, actualBenefitValue: 40, benefitConfidence: 100 })] },
      ),
    });
    expect(screen.getByTestId("portfolio-benefits-row-eu-local")).toHaveTextContent("local planned");
  });
});
