import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ProjectHealth, rollupProjectHealth, scoreProjectHealth, ragBucket, riskSeverity, healthBand, isDone } from "./ProjectHealth";
import type { ProjectItems } from "../../lib/portfolio-value";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, EUR: 1.1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
// Health fields are all on the typed Issue (quality/financial/benefits groups); the factory takes a loose
// record and casts so a test can seed exactly the risk signals it cares about.
const issue = (o: Record<string, unknown> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as unknown as Issue);

// A fixed "now" so schedule-slip tests are deterministic.
const NOW = Date.parse("2026-07-01T00:00:00Z");
const items = (id: string, name: string, list: Record<string, unknown>[], currency = "GBP"): ProjectItems => ({ projectId: id, projectName: name, programmeId: null, programmeName: null, currency, items: list as unknown as ProjectItems["items"] });

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("ragBucket / riskSeverity / healthBand / isDone", () => {
  it("normalises health status into RAG buckets", () => {
    expect(ragBucket("green")).toBe("green");
    expect(ragBucket("on_track")).toBe("green");
    expect(ragBucket("amber")).toBe("amber");
    expect(ragBucket("at_risk")).toBe("amber");
    expect(ragBucket("red")).toBe("red");
    expect(ragBucket("off_track")).toBe("red");
    expect(ragBucket(null)).toBe("none");
    expect(ragBucket("")).toBe("none");
  });
  it("maps risk level to a 0..1 severity (null when unknown)", () => {
    expect(riskSeverity("high")).toBe(1);
    expect(riskSeverity("critical")).toBe(1);
    expect(riskSeverity("medium")).toBe(0.5);
    expect(riskSeverity("low")).toBe(0);
    expect(riskSeverity(null)).toBeNull();
    expect(riskSeverity("mauve")).toBeNull();
  });
  it("bands scores green/amber/red and detects done status", () => {
    expect(healthBand(85)).toBe("green");
    expect(healthBand(70)).toBe("green");
    expect(healthBand(55)).toBe("amber");
    expect(healthBand(39)).toBe("red");
    expect(isDone("done")).toBe(true);
    expect(isDone("in_progress")).toBe(false);
  });
});

describe("scoreProjectHealth", () => {
  it("gives a clean, on-track, on-budget project a green score of 100", () => {
    const row = scoreProjectHealth(
      items("p", "Healthy", [
        { id: "1", status: "done", healthStatus: "green", riskLevel: "low", budget: 100, actualCost: 40, benefitConfidence: 100 },
        { id: "2", status: "done", healthStatus: "green", riskLevel: "low", budget: 100, actualCost: 30, benefitConfidence: 100 },
      ]),
      "GBP",
      undefined,
      NOW,
    );
    expect(row.score).toBe(100);
    expect(row.band).toBe("green");
    expect(row.overdue).toBe(0);
    expect(row.burn).toBe(35); // (40+30) / (100+100) = 35%
    expect(row.confidence).toBe(100);
    expect(row.factors).toEqual([]);
  });

  it("penalises red status, high risk, blocks, overdue open items, budget burn and low confidence", () => {
    const row = scoreProjectHealth(
      items("p", "At risk", [
        { id: "1", status: "in_progress", healthStatus: "red", riskLevel: "critical", blocked: true, dueDate: "2026-06-01", budget: 100, actualCost: 95, benefitConfidence: 20 },
        { id: "2", status: "in_progress", healthStatus: "red", riskLevel: "high", blocked: true, dueDate: "2026-06-15", budget: 100, actualCost: 90, benefitConfidence: 30 },
      ]),
      "GBP",
      undefined,
      NOW,
    );
    expect(row.score).toBeLessThan(40);
    expect(row.band).toBe("red");
    expect(row.overdue).toBe(2);
    expect(row.blockedCount).toBe(2);
    // Every scoring factor should surface as a driver, worst (biggest penalty) first.
    expect(row.factors[0]!.penalty).toBeGreaterThanOrEqual(row.factors[1]!.penalty);
    expect(row.factors.map((f) => f.key)).toContain("status");
    expect(row.factors.map((f) => f.key)).toContain("slip");
    expect(row.factors.map((f) => f.key)).toContain("blocked");
  });

  it("does not count a cancelled past-due item as overdue", () => {
    const row = scoreProjectHealth(
      items("p", "P", [{ id: "1", status: "cancelled", dueDate: "2026-01-01" }]),
      "GBP",
      undefined,
      NOW,
    );
    expect(row.overdue).toBe(0);
  });

  it("returns null burn/confidence when the fields are absent", () => {
    const row = scoreProjectHealth(items("p", "P", [{ id: "1", status: "todo", healthStatus: "green" }]), "GBP", undefined, NOW);
    expect(row.burn).toBeNull();
    expect(row.confidence).toBeNull();
  });

  it("converts budget & cost into the reporting currency before computing burn", () => {
    // EUR budget/cost convert by the EUR rate; burn is a ratio so it's currency-invariant, but the
    // consolidation must not throw and the ratio must hold.
    const row = scoreProjectHealth(items("p", "P", [{ id: "1", status: "todo", budget: 200, actualCost: 100 }], "EUR"), "GBP", FX.rates, NOW);
    expect(row.burn).toBe(50);
  });
});

describe("rollupProjectHealth", () => {
  it("ranks projects worst health first and counts the RAG bands", () => {
    const roll = rollupProjectHealth(
      [
        items("healthy", "Healthy", [{ id: "1", status: "done", healthStatus: "green", riskLevel: "low", budget: 100, actualCost: 20, benefitConfidence: 95 }]),
        items("sick", "Sick", [{ id: "2", status: "in_progress", healthStatus: "red", riskLevel: "critical", blocked: true, dueDate: "2026-01-01", budget: 100, actualCost: 99, benefitConfidence: 10 }]),
      ],
      "GBP",
      undefined,
      NOW,
    );
    expect(roll.rows.map((r) => r.key)).toEqual(["sick", "healthy"]); // worst first
    expect(roll.totals.projects).toBe(2);
    expect(roll.totals.red).toBe(1);
    expect(roll.totals.green).toBe(1);
    expect(roll.totals.meanHealth).toBe(Math.round((roll.rows[0]!.score + roll.rows[1]!.score) / 2));
  });

  it("skips projects with no work items", () => {
    const roll = rollupProjectHealth([items("empty", "Empty", [])], "GBP", undefined, NOW);
    expect(roll.rows).toHaveLength(0);
    expect(roll.totals.projects).toBe(0);
  });
});

describe("ProjectHealth", () => {
  it("renders the at-risk ranking with a health band and drivers", () => {
    renderWithProviders(<ProjectHealth />, {
      client: seed([project({ id: "a", name: "Alpha" }), project({ id: "b", name: "Bravo" })], {
        a: [issue({ id: "1", status: "in_progress", healthStatus: "red", riskLevel: "high", blocked: true, dueDate: "2026-06-01", budget: 100, actualCost: 96, benefitConfidence: 15 })],
        b: [issue({ id: "2", status: "done", healthStatus: "green", riskLevel: "low", budget: 100, actualCost: 30, benefitConfidence: 90 })],
      }),
    });
    expect(screen.getByTestId("project-health")).toBeInTheDocument();
    expect(screen.getByTestId("health-distribution")).toBeInTheDocument();
    // Alpha is the sick project → carries drivers.
    expect(screen.getByTestId("project-health-row-a-drivers")).toBeInTheDocument();
    expect(screen.getByTestId("project-health-row-b")).toBeInTheDocument();
  });

  it("shows the empty state when no project has work items", () => {
    renderWithProviders(<ProjectHealth />, { client: seed([project({ id: "a" })], { a: [] }) });
    expect(screen.getByTestId("project-health-empty")).toBeInTheDocument();
  });
});
