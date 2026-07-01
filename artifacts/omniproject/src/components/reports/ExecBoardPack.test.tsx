import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
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
    const rows = screen.getAllByTestId(/exec-exception-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["exec-exception-c", "exec-exception-b"]);
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
});
