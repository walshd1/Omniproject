import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("makes a positive BLOCKERS count its own drill-through to the grid, pre-filtered to blocked items (backlog #122)", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    // Bravo has 4 blockers — its BLOCKERS figure is a drill-through, declared by the portfolioHealth
    // widget's own JSON (drillTo: blocked truthy), not hardcoded in this component.
    const drill = screen.getByTestId("kpi-blockers-drill-bravo");
    expect(drill).toHaveTextContent("4");
    expect(drill).toHaveAttribute("data-href", expect.stringContaining("/projects/bravo?filter="));
    expect(drill.getAttribute("data-href")).toContain(encodeURIComponent(JSON.stringify({ all: [{ field: "blocked", op: "truthy" }] })));

    // The card's own project link is still intact (the drill-through is additive, not a replacement).
    expect(screen.getByTestId("kpi-bravo")).toHaveAttribute("href", "/projects/bravo");
  });

  it("does not offer a drill-through for a project with zero blockers", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    // Alpha has 0 blockers — nothing to drill into.
    expect(screen.queryByTestId("kpi-blockers-drill-alpha")).toBeNull();
  });

  it("makes a negative SCHED Δ its own drill-through to the grid, pre-filtered to overdue items (backlog #132)", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    // Bravo is slipping (-3d) — its SCHED Δ figure drills to that project's overdue, still-open items.
    const drill = screen.getByTestId("kpi-schedule-drill-bravo");
    expect(drill).toHaveTextContent("-3d");
    expect(drill).toHaveAttribute("data-href", expect.stringContaining("/projects/bravo?filter="));

    // Alpha is ahead of schedule (+2d) — nothing to drill into.
    expect(screen.queryByTestId("kpi-schedule-drill-alpha")).toBeNull();
  });

  it("makes a positive BUDGET Δ its own drill-through to the grid, pre-filtered to cost-incurring items (backlog #132)", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    // Bravo is over budget (+12%) — its BUDGET Δ figure drills to that project's cost-incurring items.
    const drill = screen.getByTestId("kpi-budget-drill-bravo");
    expect(drill).toHaveTextContent("+12%");
    expect(drill).toHaveAttribute("data-href", expect.stringContaining("/projects/bravo?filter="));
    expect(drill.getAttribute("data-href")).toContain(encodeURIComponent(JSON.stringify({ all: [{ field: "actualCost", op: "gt", value: 0 }] })));

    // Alpha is under budget (-5%) — nothing to drill into.
    expect(screen.queryByTestId("kpi-budget-drill-alpha")).toBeNull();
  });

  it("navigates to the pre-filtered grid when a drill figure is activated (click + keyboard)", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), ROWS);
    renderWithProviders(<PortfolioKpi />, { client: qc });

    // Clicking the BLOCKERS drill runs open() → stopPropagation + navigate(drill.href).
    fireEvent.click(screen.getByTestId("kpi-blockers-drill-bravo"));
    expect(window.location.pathname).toBe("/projects/bravo");
    expect(decodeURIComponent(window.location.search)).toContain('"field":"blocked"');

    // Enter on the BUDGET drill takes the keyboard path through the same handler.
    fireEvent.keyDown(screen.getByTestId("kpi-budget-drill-bravo"), { key: "Enter" });
    expect(decodeURIComponent(window.location.search)).toContain('"field":"actualCost"');

    // A non-Enter key is a no-op (guards the onKeyDown branch) — search stays on actualCost.
    fireEvent.keyDown(screen.getByTestId("kpi-budget-drill-bravo"), { key: "a" });
    expect(decodeURIComponent(window.location.search)).toContain('"field":"actualCost"');
  });

  it("falls back to the AMBER palette for an unrecognised RAG status", () => {
    const qc = makeClient();
    qc.setQueryData(getGetPortfolioHealthQueryKey(), [
      { projectId: "zeta", projectName: "Project Zeta", ragStatus: "UNKNOWN", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0 },
    ] as unknown as PortfolioHealthSummary[]);
    renderWithProviders(<PortfolioKpi />, { client: qc });
    // The raw status is still shown; the card renders (RAG[...] ?? RAG.AMBER kept it from throwing).
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByTestId("kpi-zeta")).toBeInTheDocument();
  });

  it("retries the portfolio query from the error surface", async () => {
    const qc = makeClient();
    renderWithProviders(<PortfolioKpi />, { client: qc });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry); // exercises the DataState onRetry → refetch()
    expect(retry).toBeInTheDocument();
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
