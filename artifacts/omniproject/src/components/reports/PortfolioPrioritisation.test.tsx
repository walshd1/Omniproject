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

  it("Optimise (max value) picks a mix under the budget cap and reports the result vs greedy", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })],
        issues: {
          a: [issue({ id: "1", projectId: "a", riceScore: 90 })],
          b: [issue({ id: "2", projectId: "b", riceScore: 40 })],
        },
        financials: { a: fin({ budgetAllocated: 1000 }), b: fin({ budgetAllocated: 1000 }) },
      }),
    });
    fireEvent.change(screen.getByLabelText("Budget cap (GBP)"), { target: { value: "1000" } });
    fireEvent.click(screen.getByTestId("priority-optimise"));
    // Only one project fits the cap; the higher-scored A is funded, B deferred.
    expect(screen.getByLabelText("Funding decision for A")).toHaveValue("fund");
    expect(screen.getByLabelText("Funding decision for B")).toHaveValue("defer");
    // The optimiser reports what it did (exact method + the value it bought).
    expect(screen.getByTestId("priority-optimise-note")).toHaveTextContent(/Optimised \(exact\)/);
  });

  it("tones the composite score by band and dashes an unscored project", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "g", name: "G" }), project({ id: "m", name: "M" }), project({ id: "r", name: "R" }), project({ id: "n", name: "N" })],
        issues: {
          g: [issue({ id: "1", projectId: "g", riceScore: 100 })], // normalises to 100 → green
          m: [issue({ id: "2", projectId: "m", riceScore: 50 })], // mid → amber
          r: [issue({ id: "3", projectId: "r", riceScore: 1 })], // lowest → red
          n: [issue({ id: "4", projectId: "n" })], // no scoring field → compositeScore null
        },
      }),
    });
    const scoreCell = (id: string) => screen.getByTestId(`priority-row-${id}`).querySelector("td:nth-child(4)")!;
    expect(scoreCell("g").className).toContain("text-green-600");
    expect(scoreCell("m").className).toContain("text-amber-500");
    expect(scoreCell("r").className).toContain("text-red-500");
    const nCell = scoreCell("n");
    expect(nCell).toHaveTextContent("—"); // cell(null) dashes
    expect(nCell.className).toContain("text-muted-foreground");
  });

  it("accepts a capacity cap, shows an over-budget hint, drives a negative benefit delta, and resets decisions", () => {
    const benefitIssue = (o: Partial<Issue> & { plannedBenefitValue: number }): Issue =>
      ({ ...issue(o), plannedBenefitValue: o.plannedBenefitValue } as unknown as Issue);
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })],
        issues: {
          a: [benefitIssue({ id: "1", projectId: "a", riceScore: 90, plannedBenefitValue: 500 })],
          b: [benefitIssue({ id: "2", projectId: "b", riceScore: 40, plannedBenefitValue: 300 })],
        },
        financials: { a: fin({ budgetAllocated: 1000 }), b: fin({ budgetAllocated: 1000 }) },
      }),
    });
    // Capacity cap onChange + numeric parse.
    fireEvent.change(screen.getByLabelText("Capacity cap"), { target: { value: "40" } });
    expect(screen.getByLabelText("Capacity cap")).toHaveValue(40);
    // Budget cap (500) below the funded cost (2000) → "over cap by" hint.
    fireEvent.change(screen.getByLabelText("Budget cap (GBP)"), { target: { value: "500" } });
    expect(screen.getByText(/over cap by/i)).toBeInTheDocument();
    // Cutting A drops funded benefit below funding-everything → the delta hint goes negative (no leading +).
    fireEvent.change(screen.getByLabelText("Funding decision for A"), { target: { value: "cut" } });
    const benefitCard = screen.getByText("Funded benefit").parentElement!;
    expect(benefitCard.textContent).toMatch(/-.*vs funding everything/);
    // A decision was made → Reset appears; clicking it clears decisions and hides itself.
    fireEvent.click(screen.getByTestId("priority-reset-decisions"));
    expect(screen.queryByTestId("priority-reset-decisions")).toBeNull();
    expect(screen.getByLabelText("Funding decision for A")).toHaveValue("fund");
  });

  it("optimise honours an existing cut as a forbid", () => {
    renderWithProviders(<PortfolioPrioritisation />, {
      client: seed({
        projects: [project({ id: "a", name: "A" }), project({ id: "b", name: "B" })],
        issues: {
          a: [issue({ id: "1", projectId: "a", riceScore: 90 })],
          b: [issue({ id: "2", projectId: "b", riceScore: 40 })],
        },
        financials: { a: fin({ budgetAllocated: 1000 }), b: fin({ budgetAllocated: 1000 }) },
      }),
    });
    fireEvent.change(screen.getByLabelText("Funding decision for A"), { target: { value: "cut" } });
    fireEvent.click(screen.getByTestId("priority-optimise"));
    // The cut project is forbidden and skipped by the optimiser's fund/defer sweep.
    expect(screen.getByLabelText("Funding decision for A")).toHaveValue("cut");
    expect(screen.getByTestId("priority-optimise-note")).toBeInTheDocument();
  });
});
