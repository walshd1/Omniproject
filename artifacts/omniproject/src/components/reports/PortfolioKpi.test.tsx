import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import {
  getGetPortfolioHealthQueryKey,
  type PortfolioHealthSummary,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioKpi } from "./PortfolioKpi";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
}

const ROWS: PortfolioHealthSummary[] = [
  {
    projectId: "alpha",
    projectName: "Project Alpha",
    ragStatus: "GREEN",
    scheduleVarianceDays: 2,
    budgetVariancePercentage: -5,
    activeBlockersCount: 0,
  },
  {
    projectId: "bravo",
    projectName: "Project Bravo",
    ragStatus: "RED",
    scheduleVarianceDays: -3,
    budgetVariancePercentage: 12,
    activeBlockersCount: 4,
  },
];

describe("PortfolioKpi", () => {
  it("renders a KPI card per project with RAG status and metrics", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    expect(screen.getByText("Portfolio Health")).toBeInTheDocument();
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("Project Bravo")).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByText("RED")).toBeInTheDocument();
    // schedule variance: positive gets "+", negative shown raw
    expect(screen.getByText("+2d")).toBeInTheDocument();
    expect(screen.getByText("-3d")).toBeInTheDocument();
    // budget variance formatting
    expect(screen.getByText("-5%")).toBeInTheDocument();
    expect(screen.getByText("+12%")).toBeInTheDocument();
    // blocker counts
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("links each card to its project route", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    const link = screen.getByTestId("kpi-alpha");
    expect(link).toHaveAttribute("href", "/projects/alpha");
  });

  it("shows the empty-state message when there is no portfolio data", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), []);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    expect(screen.getByText("No portfolio data.")).toBeInTheDocument();
  });

  it("renders an error alert with a retry control when the query errors", async () => {
    // No seeding + retry:false: the generated hook's fetch fails in jsdom
    // (no base URL), driving the component into its error surface.
    const qc = makeClient();
    renderWithProviders(<PortfolioKpi />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("Could not load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
