import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetPortfolioHealthQueryKey,
  type Project,
  type PortfolioHealthSummary,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioTrends } from "./PortfolioTrends";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 10, completedCount: 5, memberCount: 1, updatedAt: "" },
] as unknown as Project[];
const portfolio = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "RED", scheduleVarianceDays: -4, budgetVariancePercentage: 8, activeBlockersCount: 2 },
] as unknown as PortfolioHealthSummary[];

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetPortfolioHealthQueryKey(), portfolio);
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("PortfolioTrends", () => {
  it("shows the empty prompt until at least two snapshots exist", () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    expect(screen.getByTestId("trend-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).not.toBeInTheDocument();
  });

  it("captures snapshots into the session and renders a trend at two points", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    const capture = screen.getByTestId("capture-snapshot");
    await userEvent.click(capture);
    await userEvent.click(capture);
    // Two captured points → the chart renders, empty prompt gone.
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-empty")).not.toBeInTheDocument();
    // The captured points are listed.
    expect(screen.getByLabelText("Captured snapshots")).toBeInTheDocument();
  });

  it("flags captured data with the provenance badge (not backend fact)", () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    expect(screen.getByText(/captured/i)).toBeInTheDocument();
  });
});
