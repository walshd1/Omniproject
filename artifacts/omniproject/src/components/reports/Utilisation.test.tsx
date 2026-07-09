import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { Utilisation, rollupUtilisation, utilisationFlag, PERIOD_CAPACITY_HOURS } from "./Utilisation";
import type { ProjectItems } from "../../lib/portfolio-value";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, EUR: 1.1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
// Utilisation reads effort fields (loggedHours/estimateHours/remainingHours/billable) + assignee off the
// item; the factory takes a loose record and casts so tests can seed them freely.
const issue = (o: Record<string, unknown> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as unknown as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("utilisationFlag", () => {
  it("buckets a utilisation percentage into overload / under / healthy", () => {
    expect(utilisationFlag(120)).toBe("overloaded");
    expect(utilisationFlag(100)).toBe("overloaded");
    expect(utilisationFlag(80)).toBe("ok");
    expect(utilisationFlag(65)).toBe("ok");
    expect(utilisationFlag(64.9)).toBe("under");
    expect(utilisationFlag(0)).toBe("under");
  });
});

describe("rollupUtilisation", () => {
  const items = (list: Record<string, unknown>[]): ProjectItems => ({ projectId: "a", projectName: "A", programmeId: null, programmeName: null, currency: "GBP", items: list as unknown as ProjectItems["items"] });

  it("rolls up per assignee: logged/estimate/remaining, billable split, utilisation and flags", () => {
    const roll = rollupUtilisation(
      [
        items([
          { id: "1", assignee: "alice", loggedHours: 100, estimateHours: 120, remainingHours: 20, billable: true },
          { id: "2", assignee: "alice", loggedHours: 60, estimateHours: 40, remainingHours: 0, billable: false },
          { id: "3", assignee: "bob", loggedHours: 30, estimateHours: 80, remainingHours: 50, billable: true },
          { id: "4", title: "noise, no assignee or hours" },
        ]),
      ],
      100, // capacity per person for easy percentages
    );
    expect(roll.rows).toHaveLength(2);
    // Busiest first: alice (160 logged) before bob (30).
    const alice = roll.rows[0]!;
    expect(alice.key).toBe("alice");
    expect(alice.items).toBe(2);
    expect(alice.logged).toBe(160);
    expect(alice.estimate).toBe(160);
    expect(alice.remaining).toBe(20);
    expect(alice.billable).toBe(100); // only the billable item's logged hours
    expect(alice.nonBillable).toBe(60);
    expect(alice.billablePct).toBe(62.5); // 100 / 160
    expect(alice.utilisation).toBe(160); // 160 / 100 capacity
    expect(alice.flag).toBe("overloaded");

    const bob = roll.rows[1]!;
    expect(bob.utilisation).toBe(30);
    expect(bob.flag).toBe("under");

    expect(roll.totals.people).toBe(2);
    expect(roll.totals.logged).toBe(190);
    expect(roll.totals.billable).toBe(130);
    expect(roll.totals.billablePct).toBe(68.4); // 130 / 190
    expect(roll.totals.overloaded).toBe(1);
    expect(roll.totals.under).toBe(1);
    expect(roll.totals.meanUtilisation).toBe(95); // (160 + 30) / 2
  });

  it("buckets un-assigned items that still carry effort into Unassigned and skips pure noise", () => {
    const roll = rollupUtilisation(
      [items([
        { id: "1", loggedHours: 10 },
        { id: "2", estimateHours: 5 },
        { id: "3", title: "ignored" },
        { id: "4", assignee: "   " },
      ])],
    );
    expect(roll.rows.map((r) => r.key)).toEqual(["unassigned"]);
    expect(roll.rows[0]!.items).toBe(2);
  });

  it("defaults to the documented period capacity", () => {
    const roll = rollupUtilisation([items([{ id: "1", assignee: "carol", loggedHours: PERIOD_CAPACITY_HOURS }])]);
    expect(roll.rows[0]!.utilisation).toBe(100);
  });
});

describe("Utilisation", () => {
  it("renders the per-assignee utilisation roll-up", () => {
    renderWithProviders(<Utilisation />, {
      client: seed([project({ id: "a" })], {
        a: [
          issue({ id: "1", assignee: "alice", loggedHours: 180, estimateHours: 160, remainingHours: 0, billable: true }),
          issue({ id: "2", assignee: "bob", loggedHours: 40, estimateHours: 120, remainingHours: 80, billable: false }),
        ],
      }),
    });
    expect(screen.getByTestId("utilisation")).toBeInTheDocument();
    expect(screen.getByTestId("utilisation-row-alice")).toBeInTheDocument();
    expect(screen.getByTestId("utilisation-row-bob")).toBeInTheDocument();
    expect(screen.getByTestId("util-flag-overloaded")).toBeInTheDocument();
  });

  it("shows the empty state when no work item carries time data", () => {
    renderWithProviders(<Utilisation />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1", assignee: "alice" })] }) });
    expect(screen.getByTestId("utilisation-empty")).toBeInTheDocument();
  });
});
