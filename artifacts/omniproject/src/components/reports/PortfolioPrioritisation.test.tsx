import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectIssuesQueryKey,
  getGetFxRatesQueryKey,
  getGetProjectFinancialsQueryKey,
  getGetProjectCapacityQueryKey,
  type Project,
  type Issue,
  type FxRates,
  type ProjectFinancials,
  type ResourceCapacity,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { priorityWeightsQueryKey } from "../../lib/priority-weights-api";
import { DEFAULT_PRIORITY_WEIGHTS } from "../../lib/portfolio-priority";
import { PortfolioPrioritisation } from "./PortfolioPrioritisation";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;

const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
const issue = (o: Partial<Issue> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as Issue);
const fin = (o: Partial<ProjectFinancials> = {}): ProjectFinancials => ({ currency: "GBP", budgetAllocated: 0, actualBurn: 0, earnedValue: 0, cpi: 1, spi: 1, financialHealth: "green", forecastCostAtCompletion: 0, ...o } as ProjectFinancials);
const resource = (o: Partial<ResourceCapacity> = {}): ResourceCapacity => ({ resourceId: "r", resourceName: "R", role: "eng", allocationPercentage: 100, assignedHours: 0, availableHours: 0, utilizationState: "normal", ...o } as ResourceCapacity);

function seed(opts: {
  projects: Project[];
  issues: Record<string, Issue[]>;
  financials?: Record<string, ProjectFinancials>;
  capacity?: Record<string, ResourceCapacity[]>;
}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), opts.projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  qc.setQueryData(priorityWeightsQueryKey, DEFAULT_PRIORITY_WEIGHTS);
  for (const [id, list] of Object.entries(opts.issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  for (const p of opts.projects) {
    qc.setQueryData(getGetProjectFinancialsQueryKey(p.id), opts.financials?.[p.id] ?? fin());
    qc.setQueryData(getGetProjectCapacityQueryKey(p.id), opts.capacity?.[p.id] ?? []);
  }
  return qc;
}

describe("PortfolioPrioritisation", () => {
  it("shows the empty state with no projects", () => {
    renderWithProviders(<PortfolioPrioritisation />, { client: seed({ projects: [], issues: {} }) });
    expect(screen.getByTestId("portfolio-prioritisation-empty")).toBeInTheDocument();
  });

  it("ranks projects by composite score, highest first", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "low", name: "Low" }), project({ id: "high", name: "High" })],
        issues: {
          low: [issue({ id: "1", projectId: "low", riceScore: 10, wsjf: 5 })],
          high: [issue({ id: "2", projectId: "high", riceScore: 90, wsjf: 80 })],
        },
      }),
    });
    expect(screen.getByTestId("portfolio-prioritisation")).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^priority-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "priority-row-high");
    expect(rows[1]).toHaveAttribute("data-testid", "priority-row-low");
  });

  it("rolls cost up from financials and capacity from assigned hours", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" })],
        issues: { a: [issue({ id: "1", projectId: "a", riceScore: 50 })] },
        financials: { a: fin({ currency: "GBP", budgetAllocated: 25000 }) },
        capacity: { a: [resource({ assignedHours: 120 }), resource({ assignedHours: 30 })] },
      }),
    });
    const row = screen.getByTestId("priority-row-a");
    expect(row).toHaveTextContent("150h"); // 120 + 30
  });

  it("changing a project's decision to Cut updates the funded count and dims the row", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })],
        issues: {
          a: [issue({ id: "1", projectId: "a", riceScore: 90 })],
          b: [issue({ id: "2", projectId: "b", riceScore: 10 })],
        },
        financials: { a: fin({ budgetAllocated: 1000 }), b: fin({ budgetAllocated: 500 }) },
      }),
    });
    const fundedCard = screen.getByText("Funded (scenario)").parentElement;
    expect(fundedCard).toHaveTextContent("2"); // funded count starts at 2 (status quo = fund all)
    const select = screen.getByLabelText("Funding decision for A");
    fireEvent.change(select, { target: { value: "cut" } });
    expect(screen.getByTestId("priority-row-a")).toHaveClass("opacity-50");
  });

  it("auto-funds top-ranked projects within a budget cap", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })],
        issues: {
          a: [issue({ id: "1", projectId: "a", riceScore: 90 })],
          b: [issue({ id: "2", projectId: "b", riceScore: 10 })],
        },
        financials: { a: fin({ budgetAllocated: 800 }), b: fin({ budgetAllocated: 800 }) },
      }),
    });
    fireEvent.change(screen.getByLabelText("Budget cap (GBP)"), { target: { value: "800" } });
    fireEvent.click(screen.getByTestId("priority-auto-fund"));
    expect(screen.getByLabelText("Funding decision for A")).toHaveValue("fund");
    expect(screen.getByLabelText("Funding decision for B")).toHaveValue("defer");
  });
});
