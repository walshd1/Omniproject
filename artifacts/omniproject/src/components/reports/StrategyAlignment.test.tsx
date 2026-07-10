import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { StrategyAlignment, rollupStrategyThemes, ragBucket } from "./StrategyAlignment";
import type { ProjectItems } from "../../lib/portfolio-value";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, EUR: 1.1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
// Strategy fields include registry passthroughs (strategicTheme/objectives/kpis) not on the typed Issue,
// so the factory takes a loose record and casts.
const issue = (o: Record<string, unknown> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as unknown as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("ragBucket", () => {
  it("normalises free-form health/benefit status into RAG buckets", () => {
    expect(ragBucket("green")).toBe("green");
    expect(ragBucket("on_track")).toBe("green");
    expect(ragBucket("realised")).toBe("green");
    expect(ragBucket("amber")).toBe("amber");
    expect(ragBucket("at_risk")).toBe("amber");
    expect(ragBucket("red")).toBe("red");
    expect(ragBucket("missed")).toBe("red");
    expect(ragBucket(null)).toBe("none");
    expect(ragBucket("")).toBe("none");
  });
});

describe("rollupStrategyThemes", () => {
  const items = (list: Record<string, unknown>[]): ProjectItems => ({ projectId: "a", projectName: "A", programmeId: null, programmeName: null, currency: "GBP", items: list as unknown as ProjectItems["items"] });

  it("groups by strategic theme, averages contribution, sums benefit and rolls up RAG", () => {
    const roll = rollupStrategyThemes(
      [
        items([
          { id: "1", strategicTheme: "Security & Trust", strategicContribution: 80, plannedBenefitValue: 100, actualBenefitValue: 40, healthStatus: "amber", objectives: ["O1"], kpis: ["Incidents"] },
          { id: "2", strategicTheme: "Security & Trust", strategicContribution: 60, plannedBenefitValue: 100, actualBenefitValue: 60, benefitStatus: "on_track" },
          { id: "3", strategicTheme: "Growth", strategicContribution: 40, plannedBenefitValue: 50, actualBenefitValue: 10, healthStatus: "red" },
          { id: "4", title: "noise" },
        ]),
      ],
      "GBP",
    );
    expect(roll.themes).toHaveLength(2);
    // Biggest planned first → Security & Trust (200) before Growth (50).
    const sec = roll.themes[0]!;
    expect(sec.key).toBe("security-trust");
    expect(sec.items).toBe(2);
    expect(sec.contribution).toBe(70); // (80 + 60) / 2
    expect(sec.planned).toBe(200);
    expect(sec.actual).toBe(100);
    expect(sec.realisation).toBe(50);
    expect(sec.rag).toEqual({ green: 1, amber: 1, red: 0 });
    expect(sec.objectives).toEqual(["O1"]);
    expect(roll.totals.themes).toBe(2);
    expect(roll.totals.planned).toBe(250);
  });

  it("falls back to the first strategic goal, then Unaligned, and skips items with no strategic signal", () => {
    const roll = rollupStrategyThemes(
      [items([
        { id: "1", strategicGoals: ["Zero Trust Security"], plannedBenefitValue: 20 },
        { id: "2", strategicContribution: 10 },
        { id: "3", title: "ignored" },
      ])],
      "GBP",
    );
    expect(roll.themes.map((t) => t.key).sort()).toEqual(["unaligned", "zero-trust-security"]);
  });

  it("converts benefit values into the reporting currency", () => {
    const roll = rollupStrategyThemes(
      [{ projectId: "e", projectName: "E", programmeId: null, programmeName: null, currency: "EUR", items: [{ id: "1", strategicTheme: "Growth", plannedBenefitValue: 110 }] as unknown as ProjectItems["items"] }],
      "GBP",
      FX.rates,
    );
    // convertAmount(110, EUR, GBP) = 110 × rate[EUR] ÷ rate[GBP] = 110 × 1.1 = 121 (same rule every report uses).
    expect(roll.themes[0]!.planned).toBe(121);
  });
});

describe("StrategyAlignment", () => {
  it("renders the per-theme strategy roll-up", () => {
    renderWithProviders(<StrategyAlignment />, {
      client: seed([project({ id: "a" })], {
        a: [
          issue({ id: "1", strategicTheme: "Security & Trust", strategicContribution: 80, plannedBenefitValue: 100, actualBenefitValue: 40, healthStatus: "amber", objectives: ["Zero critical incidents"], kpis: ["Auth incidents / yr"] }),
          issue({ id: "2", strategicTheme: "Customer Growth", strategicContribution: 60, plannedBenefitValue: 50, actualBenefitValue: 52, benefitStatus: "realised" }),
        ],
      }),
    });
    expect(screen.getByTestId("strategy-alignment")).toBeInTheDocument();
    const row = screen.getByTestId("strategy-alignment-row-security-trust");
    expect(row).toHaveTextContent("80%");
    expect(screen.getByTestId("strategy-alignment-row-security-trust-okr")).toHaveTextContent("Zero critical incidents");
    expect(screen.getByTestId("strategy-alignment-row-customer-growth")).toBeInTheDocument();
  });

  it("shows the empty state when no work item carries strategic data", () => {
    renderWithProviders(<StrategyAlignment />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1" })] }) });
    expect(screen.getByTestId("strategy-alignment-empty")).toBeInTheDocument();
  });
});
