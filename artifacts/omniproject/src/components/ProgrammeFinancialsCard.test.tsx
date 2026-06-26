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
  reporting: { total: 2, costed: 2, earnedValue: 2, committed: 2 },
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

  it("shows a 'reporting' badge when every costed project reports", () => {
    renderWithProviders(<ProgrammeFinancialsCard financials={FIN} />, { client: client(true) });
    // EV is complete (2/2) — a reassuring badge, value still shown.
    expect(screen.getAllByText("2/2 reporting").length).toBeGreaterThan(0);
  });

  it("does NOT silently hide earned value when only some projects report it", () => {
    // 5 projects costed, only 3 report EV → earnedValue rolls up null, but the
    // metric must still be visible as 'Partial' with a 3/5 badge (the fix).
    const partial: ProgrammeFinancials = {
      ...FIN, earnedValue: null, cpi: null,
      reporting: { total: 6, costed: 5, earnedValue: 3, committed: 5 },
    };
    renderWithProviders(<ProgrammeFinancialsCard financials={partial} />, { client: client(true) });
    expect(screen.getByText("Earned value")).toBeInTheDocument(); // not hidden
    expect(screen.getByText("Partial")).toBeInTheDocument();
    expect(screen.getByText("3/5 reporting")).toBeInTheDocument();
    // headline coverage badge: 5 of 6 member projects carry financials
    expect(screen.getByText("5/6 reporting")).toBeInTheDocument();
  });

  it("hides earned value entirely only when no project reports it", () => {
    const none: ProgrammeFinancials = {
      ...FIN, earnedValue: null, cpi: null,
      reporting: { total: 2, costed: 2, earnedValue: 0, committed: 2 },
    };
    renderWithProviders(<ProgrammeFinancialsCard financials={none} />, { client: client(true) });
    expect(screen.queryByText("Earned value")).toBeNull();
  });
});
