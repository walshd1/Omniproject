import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  getGetProjectFinancialsQueryKey,
  type Capabilities,
  type ProjectFinancials,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { ProjectFinancialsStrip } from "./ProjectFinancialsStrip";

const FIN: ProjectFinancials = {
  currency: "GBP",
  budgetAllocated: 480000,
  actualBurn: 312000,
  earnedValue: 288000,
  cpi: 0.92,
  spi: 0.88,
  financialHealth: "AMBER",
  forecastCostAtCompletion: 521739,
};

function client(financials: boolean, fin?: ProjectFinancials): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: "demo", financials } as unknown as Capabilities);
  if (fin) qc.setQueryData(getGetProjectFinancialsQueryKey("p1"), fin);
  return qc;
}

describe("ProjectFinancialsStrip", () => {
  it("shows the EVM summary when financials are supported", () => {
    renderWithProviders(<ProjectFinancialsStrip projectId="p1" />, { client: client(true, FIN) });
    expect(screen.getByTestId("project-financials")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("AMBER")).toBeInTheDocument();
    expect(screen.getByText("0.92")).toBeInTheDocument(); // CPI < 1
  });

  it("renders nothing when the backend cannot surface financials", () => {
    const { container } = renderWithProviders(<ProjectFinancialsStrip projectId="p1" />, { client: client(false, FIN) });
    expect(container.querySelector('[data-testid="project-financials"]')).toBeNull();
  });
});
