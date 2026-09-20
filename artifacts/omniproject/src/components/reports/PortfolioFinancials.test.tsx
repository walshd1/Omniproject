import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetPortfolioFinancialsQueryKey, getGetFxRatesQueryKey, getGetSettingsQueryKey,
  type PortfolioFinancials as PortfolioFinancialsData, type FinanceRollup, type FxRates, type Settings,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioFinancials } from "./PortfolioFinancials";

// The report is now a thin view over GET /api/portfolio/financials — the consolidation is server-side
// (covered by the backend consolidateFinancials unit + the /api/portfolio/financials integration test).
// These tests seed the consolidated payload and assert the RENDER (cards / rows / local-currency line).
const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, JPY: 0.005 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;

function roll(over: Partial<FinanceRollup> = {}): FinanceRollup {
  return { key: "k", label: "Row", projects: 1, budget: 1000, actual: 400, forecast: 1000, earnedValue: 400, variance: 0, cpi: 1, localCurrency: null, local: null, excludedForFx: 0, ...over } as FinanceRollup;
}
function payload(over: Partial<PortfolioFinancialsData> = {}): PortfolioFinancialsData {
  return {
    reportingCurrency: "GBP",
    programmes: [],
    portfolio: roll({ key: "__portfolio__", label: "Portfolio", projects: 0 }),
    currencyMix: [],
    fx: { base: "GBP", provenance: "sample", asOf: "2026-01-01T00:00:00Z" },
    ...over,
  } as PortfolioFinancialsData;
}

function seed(data: PortfolioFinancialsData, settings?: Partial<Settings>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetPortfolioFinancialsQueryKey(), data);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  qc.setQueryData(getGetSettingsQueryKey(), { aiProvider: "none", backendSource: "all", ...settings } as Settings);
  return qc;
}

describe("PortfolioFinancials", () => {
  it("renders the programme roll-up rows the endpoint returns", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(payload({
        programmes: [roll({ key: "p1", label: "Platform", projects: 2, budget: 1500, forecast: 1600, variance: -100 })],
        portfolio: roll({ key: "__portfolio__", label: "Portfolio", projects: 2, budget: 1500, forecast: 1600, variance: -100 }),
      })),
    });
    expect(screen.getByTestId("portfolio-financials")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-fin-row-p1")).toBeInTheDocument();
  });

  it("shows the empty state when the portfolio has no projects", () => {
    renderWithProviders(<PortfolioFinancials />, { client: seed(payload()) });
    expect(screen.getByTestId("portfolio-fin-empty")).toBeInTheDocument();
  });

  it("shows a local-currency figure alongside a single-currency programme's consolidated total", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(payload({
        reportingCurrency: "GBP",
        programmes: [roll({ key: "jp", label: "Japan", projects: 2, localCurrency: "JPY", local: { budget: 800000, actual: 0, forecast: 800000, earnedValue: 0 } })],
        portfolio: roll({ key: "__portfolio__", label: "Portfolio", projects: 2 }),
      })),
    });
    expect(screen.getByTestId("portfolio-fin-row-jp-local")).toHaveTextContent("local budget");
  });

  it("does not show a local-currency line once a programme mixes currencies", () => {
    renderWithProviders(<PortfolioFinancials />, {
      client: seed(payload({
        programmes: [roll({ key: "mixed", label: "Mixed", projects: 2, localCurrency: null, local: null })],
        portfolio: roll({ key: "__portfolio__", label: "Portfolio", projects: 2 }),
      })),
    });
    expect(screen.queryByTestId("portfolio-fin-row-mixed-local")).not.toBeInTheDocument();
  });
});

describe("degraded reads", () => {
  it("an OUTAGE must not render as 'no financials — connect a cost source'", () => {
    // The trap this closes: an outage leaves portfolio.projects === 0, which used to fall through to
    // the empty state and tell the user to go buy an ERP integration. That is advice about a product
    // gap when the truth is that a backend timed out — actively misleading, and it hides a real fault.
    const degraded = payload({
      availability: { complete: false, attempted: 4, answered: 3, unavailable: [{ source: "project:p-2", reason: "financials read failed" }] },
    } as Partial<PortfolioFinancialsData>);
    renderWithProviders(<PortfolioFinancials />, { client: seed(degraded) });

    expect(screen.queryByTestId("portfolio-fin-empty")).toBeNull();
    const notice = screen.getByTestId("sources-unavailable-notice");
    expect(notice).toHaveTextContent("3 of 4 sources reporting");
    // Plain sentence, not the raw `project:p-2` key — that belongs in the gateway's logs.
    expect(notice).toHaveTextContent("One project's data didn't load.");
  });

  it("a genuinely empty portfolio STILL gets the empty state (the outage path must not swallow it)", () => {
    const empty = payload({
      availability: { complete: true, attempted: 4, answered: 4, unavailable: [] },
    } as Partial<PortfolioFinancialsData>);
    renderWithProviders(<PortfolioFinancials />, { client: seed(empty) });
    expect(screen.getByTestId("portfolio-fin-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("sources-unavailable-notice")).toBeNull();
  });
});
