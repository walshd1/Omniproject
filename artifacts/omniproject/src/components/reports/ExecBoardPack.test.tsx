import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, within } from "@testing-library/react";
import {
  getListProjectsQueryKey, getGetPortfolioHealthQueryKey, getGetFxRatesQueryKey, getGetProjectFinancialsQueryKey,
  type Project, type PortfolioHealthSummary, type ProjectFinancials, type FxRates,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ExecBoardPack } from "./ExecBoardPack";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25 }, provenance: "sample", asOf: "2026-06-01T00:00:00Z" } as FxRates;

function proj(over: Partial<Project>): Project {
  return { id: "p", name: "P", programmeId: "pr1", programmeName: "Platform", issueCount: 0, completedCount: 0, memberCount: 0, source: "jira", ...over } as Project;
}
function health(over: Partial<PortfolioHealthSummary>): PortfolioHealthSummary {
  return { projectId: "p", projectName: "P", ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: 0, activeBlockersCount: 0, ...over } as PortfolioHealthSummary;
}
function fin(over: Partial<ProjectFinancials> = {}): ProjectFinancials {
  return { currency: "GBP", budgetAllocated: 1000, actualBurn: 400, earnedValue: 400, cpi: 1, spi: 1, financialHealth: "GREEN", forecastCostAtCompletion: 1100, ...over } as ProjectFinancials;
}

function seed(opts: { projects: Project[]; health: PortfolioHealthSummary[]; fin?: Record<string, ProjectFinancials> }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), opts.projects);
  qc.setQueryData(getGetPortfolioHealthQueryKey(), opts.health);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, f] of Object.entries(opts.fin ?? {})) qc.setQueryData(getGetProjectFinancialsQueryKey(id), f);
  return qc;
}

afterEach(() => vi.unstubAllGlobals());

describe("ExecBoardPack", () => {
  it("renders the headline, RAG counts and the exceptions table worst-first", () => {
    const client = seed({
      projects: [proj({ id: "a", name: "Alpha" }), proj({ id: "b", name: "Bravo", programmeId: "pr2", programmeName: "Mobile" }), proj({ id: "c", name: "Cad" })],
      health: [
        health({ projectId: "a", projectName: "Alpha", ragStatus: "GREEN" }),
        health({ projectId: "b", projectName: "Bravo", ragStatus: "AMBER", scheduleVarianceDays: -2, activeBlockersCount: 1 }),
        health({ projectId: "c", projectName: "Cad", ragStatus: "RED", scheduleVarianceDays: -9, budgetVariancePercentage: 15, activeBlockersCount: 4 }),
      ],
    });
    renderWithProviders(<ExecBoardPack />, { client });

    expect(screen.getByTestId("exec-board-pack")).toBeInTheDocument();
    expect(screen.getByTestId("exec-headline")).toHaveTextContent("1/3 on track");
    // exceptions: RED (Cad) before AMBER (Bravo); green Alpha excluded.
    const rows = screen.getAllByTestId(/^exec-exception-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["exec-exception-c", "exec-exception-b"]);
  });

  it("makes each exception row's positive blocker count a drill-through to that project's grid, pre-filtered to blocked items (backlog #122)", () => {
    const client = seed({
      projects: [proj({ id: "b", name: "Bravo" }), proj({ id: "c", name: "Cad" })],
      health: [
        health({ projectId: "b", projectName: "Bravo", ragStatus: "AMBER", activeBlockersCount: 0 }),
        health({ projectId: "c", projectName: "Cad", ragStatus: "RED", activeBlockersCount: 4 }),
      ],
    });
    renderWithProviders(<ExecBoardPack />, { client });

    // Cad has blockers — its figure is a real drill-through link into /projects/c, pre-filtered.
    const drill = screen.getByTestId("exec-blockers-drill-c");
    expect(drill).toHaveTextContent("4");
    expect(drill).toHaveAttribute("href", expect.stringContaining("/projects/c?filter="));
    expect(drill.getAttribute("href")).toContain(encodeURIComponent(JSON.stringify({ all: [{ field: "blocked", op: "truthy" }] })));

    // Bravo has zero blockers — nothing to drill into, so no drill link renders for it.
    expect(screen.queryByTestId("exec-blockers-drill-b")).toBeNull();
  });

  it("makes each exception row's schedule slip and budget overrun their own drill-throughs (backlog #132)", () => {
    const client = seed({
      projects: [proj({ id: "b", name: "Bravo" }), proj({ id: "c", name: "Cad" })],
      health: [
        // Bravo: ahead of schedule and under budget — neither figure has anything to drill into.
        health({ projectId: "b", projectName: "Bravo", ragStatus: "AMBER", scheduleVarianceDays: 2, budgetVariancePercentage: -5 }),
        // Cad: slipping and over budget — both figures drill through.
        health({ projectId: "c", projectName: "Cad", ragStatus: "RED", scheduleVarianceDays: -9, budgetVariancePercentage: 15 }),
      ],
    });
    renderWithProviders(<ExecBoardPack />, { client });

    const scheduleDrill = screen.getByTestId("exec-schedule-drill-c");
    expect(scheduleDrill).toHaveTextContent("-9d");
    expect(scheduleDrill).toHaveAttribute("href", expect.stringContaining("/projects/c?filter="));

    const budgetDrill = screen.getByTestId("exec-budget-drill-c");
    expect(budgetDrill).toHaveTextContent("+15%");
    expect(budgetDrill).toHaveAttribute("href", expect.stringContaining("/projects/c?filter="));
    expect(budgetDrill.getAttribute("href")).toContain(encodeURIComponent(JSON.stringify({ all: [{ field: "actualCost", op: "gt", value: 0 }] })));

    expect(screen.queryByTestId("exec-schedule-drill-b")).toBeNull();
    expect(screen.queryByTestId("exec-budget-drill-b")).toBeNull();
  });

  it("shows consolidated financials when projects report them", () => {
    const client = seed({
      projects: [proj({ id: "a", name: "Alpha" })],
      health: [health({ projectId: "a", ragStatus: "GREEN" })],
      fin: { a: fin({ budgetAllocated: 2000, forecastCostAtCompletion: 2500 }) },
    });
    renderWithProviders(<ExecBoardPack />, { client });
    expect(screen.getByText("Forecast (EAC)")).toBeInTheDocument();
    expect(screen.getByText("projected overspend")).toBeInTheDocument(); // EAC 2500 > budget 2000
  });

  it("celebrates an all-green portfolio with no exceptions", () => {
    const client = seed({ projects: [proj({ id: "a" })], health: [health({ projectId: "a", ragStatus: "GREEN" })] });
    renderWithProviders(<ExecBoardPack />, { client });
    expect(screen.getByTestId("exec-no-exceptions")).toBeInTheDocument();
  });

  it("captures a board-pack snapshot of the consolidated data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ manifest: { id: "s", scope: "exec-board-pack", label: "x", createdAt: "2026-06-30T00:00:00.000Z", rowCount: 1, contentHash: "h", hashAlgorithm: "sha256" }, data: {} }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { default: userEvent } = await import("@testing-library/user-event");

    const client = seed({ projects: [proj({ id: "a" })], health: [health({ projectId: "a", ragStatus: "RED", activeBlockersCount: 2 })] });
    renderWithProviders(<ExecBoardPack />, { client });
    await userEvent.click(screen.getByTestId("snapshot-capture"));

    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/snapshots/capture")!;
    expect(call).toBeTruthy();
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({ scope: "exec-board-pack" });
  });

  it("shows an empty state with no portfolio data", () => {
    renderWithProviders(<ExecBoardPack />, { client: seed({ projects: [], health: [] }) });
    expect(screen.getByTestId("exec-pack-empty")).toBeInTheDocument();
  });

  it("lets the user add an arbitrary library component to the board pack, and remove it again", () => {
    const client = seed({ projects: [proj({ id: "a" })], health: [health({ projectId: "a", ragStatus: "GREEN" })] });
    renderWithProviders(<ExecBoardPack />, { client });

    expect(screen.queryByTestId("exec-pack-extra-widget:projectCount")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add component to board pack"), { target: { value: "widget:projectCount" } });
    const extra = screen.getByTestId("exec-pack-extra-widget:projectCount");
    expect(extra).toBeInTheDocument();
    // The added widget renders inline (it reads the same seeded project list).
    expect(within(extra).getByText("Projects")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Remove Project count from board pack/i));
    expect(screen.queryByTestId("exec-pack-extra-widget:projectCount")).not.toBeInTheDocument();
  });
});
