import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import {
  getGetProjectFinancialsQueryKey,
  type ProjectFinancials,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { FinancialEvmChart } from "./FinancialEvmChart";

const PROJECT = "proj-1";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

const FINANCIALS: ProjectFinancials = {
  currency: "USD",
  budgetAllocated: 100000,
  actualBurn: 60000,
  earnedValue: 55000,
  cpi: 0.92,
  spi: 1.05,
  financialHealth: "AMBER",
  forecastCostAtCompletion: 110000,
  provenance: "sourced",
};

describe("FinancialEvmChart", () => {
  it("renders EVM stats and indices from seeded financials", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectFinancialsQueryKey(PROJECT), FINANCIALS);
    renderWithProviders(<FinancialEvmChart projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Earned Value (EVM)")).toBeInTheDocument();
    expect(screen.getByText("Budget (BAC)")).toBeInTheDocument();
    expect(screen.getByText("Actual Burn (AC)")).toBeInTheDocument();
    expect(screen.getByText("Forecast (EAC)")).toBeInTheDocument();
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByText("AMBER")).toBeInTheDocument();
    // CPI/SPI rounded to two decimals.
    expect(screen.getByText("CPI")).toBeInTheDocument();
    expect(screen.getByText("0.92")).toBeInTheDocument();
    expect(screen.getByText("SPI")).toBeInTheDocument();
    expect(screen.getByText("1.05")).toBeInTheDocument();
  });

  it("offers a display-currency selector defaulting to the native currency", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectFinancialsQueryKey(PROJECT), FINANCIALS);
    renderWithProviders(<FinancialEvmChart projectId={PROJECT} />, { client: qc });

    expect(screen.getByText("Display currency")).toBeInTheDocument();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("USD");
  });

  it("surfaces the data-source dependency note when budget is unavailable", () => {
    const qc = makeClient();
    qc.setQueryData(getGetProjectFinancialsQueryKey(PROJECT), {
      ...FINANCIALS,
      budgetAllocated: null,
    } as unknown as ProjectFinancials);
    renderWithProviders(<FinancialEvmChart projectId={PROJECT} />, { client: qc });

    expect(screen.getByText(/Financial data not available/i)).toBeInTheDocument();
    expect(screen.getByText("get_project_financials")).toBeInTheDocument();
    // No currency selector in the unavailable state.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders an error alert with retry when financials fail to load", async () => {
    const qc = makeClient();
    renderWithProviders(<FinancialEvmChart projectId={PROJECT} />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
