import { describe, it, expect, beforeEach } from "vitest";
import { screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetPortfolioHealthQueryKey,
  type Project,
  type PortfolioHealthSummary,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { loadSnapshots } from "../../lib/snapshots";
import { ScenarioSandbox } from "./ScenarioSandbox";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 10, completedCount: 5, memberCount: 1, updatedAt: "" },
  { id: "p2", name: "Beta", identifier: "BE", source: "jira", issueCount: 4, completedCount: 4, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

const portfolio = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "RED", scheduleVarianceDays: -4, budgetVariancePercentage: 8, activeBlockersCount: 2 },
  { projectId: "p2", projectName: "Beta", ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: -3, activeBlockersCount: 1 },
] as unknown as PortfolioHealthSummary[];

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetPortfolioHealthQueryKey(), portfolio);
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("ScenarioSandbox", () => {
  it("renders the baseline KPIs from the live read-model", () => {
    renderWithProviders(<ScenarioSandbox />, { client: seeded() });
    expect(screen.getByTestId("scenario-sandbox")).toBeInTheDocument();
    const kpi = screen.getByTestId("scenario-kpi");
    // Completion = (5+4)/(10+4)*100 = 64.3
    expect(within(kpi).getByLabelText("Completion baseline")).toHaveTextContent("64.3%");
    expect(within(kpi).getByLabelText("Completion scenario")).toHaveTextContent("64.3%");
    expect(within(kpi).getByLabelText("Completion delta")).toHaveTextContent("0%");
  });

  it("updates the scenario KPI and delta when a lever changes", async () => {
    renderWithProviders(<ScenarioSandbox />, { client: seeded() });
    const input = screen.getByLabelText("Completion delta % for Alpha");
    await userEvent.clear(input);
    await userEvent.type(input, "30"); // p1 50%->80% -> 8 completed; (8+4)/14 = 85.7
    const kpi = screen.getByTestId("scenario-kpi");
    expect(within(kpi).getByLabelText("Completion scenario")).toHaveTextContent("85.7%");
    expect(within(kpi).getByLabelText("Completion delta")).toHaveTextContent("+21.4%");
    // baseline unchanged
    expect(within(kpi).getByLabelText("Completion baseline")).toHaveTextContent("64.3%");
  });

  it("reflects blocker deltas (clamped >= 0) in the scenario", async () => {
    renderWithProviders(<ScenarioSandbox />, { client: seeded() });
    const input = screen.getByLabelText("Blockers delta for Alpha");
    // Number inputs don't take a typed "-" reliably in jsdom; set the value directly.
    fireEvent.change(input, { target: { value: "-5" } }); // p1 2 -> 0, total 3 -> 1
    const kpi = screen.getByTestId("scenario-kpi");
    expect(within(kpi).getByLabelText("Blockers scenario")).toHaveTextContent("1");
    expect(within(kpi).getByLabelText("Blockers delta")).toHaveTextContent("-2");
  });

  it("Reset restores the baseline scenario", async () => {
    renderWithProviders(<ScenarioSandbox />, { client: seeded() });
    const input = screen.getByLabelText("Completion delta % for Alpha");
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    const kpi = screen.getByTestId("scenario-kpi");
    expect(within(kpi).getByLabelText("Completion scenario")).toHaveTextContent("85.7%");

    await userEvent.click(screen.getByTestId("scenario-reset"));
    expect(within(kpi).getByLabelText("Completion scenario")).toHaveTextContent("64.3%");
    expect(within(kpi).getByLabelText("Completion delta")).toHaveTextContent("0%");
    expect((screen.getByLabelText("Completion delta % for Alpha") as HTMLInputElement).value).toBe("0");
  });

  it("Capture as snapshot persists the adjusted scenario to sessionStorage", async () => {
    renderWithProviders(<ScenarioSandbox />, { client: seeded() });
    expect(loadSnapshots()).toHaveLength(0);

    const input = screen.getByLabelText("Completion delta % for Alpha");
    await userEvent.clear(input);
    await userEvent.type(input, "30");
    await userEvent.click(screen.getByTestId("scenario-capture"));

    const snaps = loadSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].label).toMatch(/^What-if:/);
    // Adjusted completedCount captured for p1 (5 -> 8).
    expect(snaps[0].projects.find((p) => p.id === "p1")?.completedCount).toBe(8);
  });
});
