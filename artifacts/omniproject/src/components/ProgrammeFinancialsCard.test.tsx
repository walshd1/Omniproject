import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetCapabilitiesQueryKey,
  type Capabilities,
  type ProgrammeFinancials,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { ProgrammeFinancialsCard } from "./ProgrammeFinancialsCard";

const FIN: ProgrammeFinancials = {
  currency: "GBP",
  budget: 700000,
  actualCost: 460000,
  earnedValue: 459000,
  committed: 70000,
  cpi: 1.0,
  variance: 240000,
  variancePct: 34,
  health: "GREEN",
  projectsCounted: 2,
};

function client(financials: boolean | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (financials !== undefined) {
    qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: "demo", financials } as unknown as Capabilities);
  }
  return qc;
}

describe("ProgrammeFinancialsCard", () => {
  it("renders the roll-up stats when financials are supported", () => {
    renderWithProviders(<ProgrammeFinancialsCard financials={FIN} />, { client: client(true) });
    expect(screen.getByTestId("programme-financials")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Committed (PO)")).toBeInTheDocument();
    expect(screen.getByText("Earned value")).toBeInTheDocument();
    expect(screen.getByText("CPI")).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
  });

  it("renders nothing when the backend cannot surface financials", () => {
    const { container } = renderWithProviders(<ProgrammeFinancialsCard financials={FIN} />, { client: client(false) });
    expect(container.querySelector('[data-testid="programme-financials"]')).toBeNull();
  });

  it("flags an over-budget programme in red", () => {
    const over: ProgrammeFinancials = { ...FIN, actualCost: 760000, variance: -60000, variancePct: -9, health: "RED" };
    renderWithProviders(<ProgrammeFinancialsCard financials={over} />, { client: client(true) });
    const variance = screen.getByText(/−.*\(-9%\)/);
    expect(variance.className).toMatch(/text-red-500/);
  });
});
