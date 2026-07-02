import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { getGetFederatedPortfolioQueryKey, type FederatedPortfolio as FederatedPortfolioData } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { FederatedPortfolio } from "./FederatedPortfolio";

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
}

const DATA: FederatedPortfolioData = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  local: {
    label: "This instance",
    region: "eu",
    summary: {
      projects: 12,
      health: { projects: 12, rag: { green: 8, amber: 3, red: 1, other: 0 }, avgScheduleVarianceDays: -1, avgBudgetVariancePercentage: 2, totalActiveBlockers: 5 },
      finance: { currency: "GBP", budget: 1000, actual: 600, forecast: 900, earnedValue: 550, variance: 100, cpi: 0.92 },
      capacity: { allocations: 20, overAllocated: 2, assignedHours: 400, availableHours: 500, utilisation: 80 },
    },
  },
  peers: [
    {
      id: "us",
      label: "US instance",
      region: "us",
      status: "ok",
      ms: 42,
      summary: {
        projects: 5,
        health: { projects: 5, rag: { green: 4, amber: 1, red: 0, other: 0 }, avgScheduleVarianceDays: 0, avgBudgetVariancePercentage: -1, totalActiveBlockers: 1 },
        finance: null,
        capacity: null,
      },
    },
    {
      id: "apac",
      label: "APAC instance",
      region: "apac",
      status: "unreachable",
      error: "timed out",
      ms: 8000,
      summary: null,
    },
  ],
};

describe("FederatedPortfolio", () => {
  it("renders the local instance's own summary, clearly labeled", () => {
    const qc = makeClient();
    qc.setQueryData(getGetFederatedPortfolioQueryKey(), DATA);
    renderWithProviders(<FederatedPortfolio />, { client: qc });

    const local = screen.getByTestId("federated-portfolio-local");
    expect(local).toHaveTextContent("This instance");
    expect(local).toHaveTextContent("eu");
    expect(local).toHaveTextContent("12"); // projects
  });

  it("renders each peer separately labeled by id/region — never blended into one number", () => {
    const qc = makeClient();
    qc.setQueryData(getGetFederatedPortfolioQueryKey(), DATA);
    renderWithProviders(<FederatedPortfolio />, { client: qc });

    const us = screen.getByTestId("federated-portfolio-peer-us");
    expect(us).toHaveTextContent("US instance");
    expect(us).toHaveTextContent("us");
    expect(us).toHaveTextContent("Online");
  });

  it("shows an unreachable/misconfigured peer as unavailable — not a fatal error for the whole view", () => {
    const qc = makeClient();
    qc.setQueryData(getGetFederatedPortfolioQueryKey(), DATA);
    renderWithProviders(<FederatedPortfolio />, { client: qc });

    const apac = screen.getByTestId("federated-portfolio-peer-apac");
    expect(apac).toHaveTextContent("Unreachable");
    expect(screen.getByTestId("federated-portfolio-peer-apac-unavailable")).toHaveTextContent("timed out");
    // The local + healthy-peer figures are still fully rendered alongside the unavailable one.
    expect(screen.getByTestId("federated-portfolio-local")).toBeInTheDocument();
    expect(screen.getByTestId("federated-portfolio-peer-us")).toBeInTheDocument();
  });

  it("shows a no-peers-configured message when the peer list is empty", () => {
    const qc = makeClient();
    qc.setQueryData(getGetFederatedPortfolioQueryKey(), { ...DATA, peers: [] });
    renderWithProviders(<FederatedPortfolio />, { client: qc });

    expect(screen.getByTestId("federated-portfolio-no-peers")).toBeInTheDocument();
  });

  it("renders an error alert with a retry control when the query errors", async () => {
    const qc = makeClient();
    renderWithProviders(<FederatedPortfolio />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
