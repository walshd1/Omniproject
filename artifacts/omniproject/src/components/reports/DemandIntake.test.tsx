import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getGetProjectIssuesQueryKey, getGetFxRatesQueryKey, type Project, type Issue, type FxRates } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { DemandIntake, rollupDemandIntake, intakeStage } from "./DemandIntake";
import type { ProjectItems } from "../../lib/portfolio-value";

const FX: FxRates = { base: "GBP", rates: { GBP: 1, USD: 1.25, EUR: 1.1 }, provenance: "sample", asOf: "2026-01-01T00:00:00Z" } as FxRates;
const project = (o: Partial<Project> = {}): Project => ({ id: "p1", name: "P1", source: "jira", ...o } as Project);
// Demand fields include registry passthroughs (requester/riceScore/wsjf/moscow) not on the typed Issue,
// so the factory takes a loose record and casts.
const issue = (o: Record<string, unknown> = {}): Issue => ({ id: "i", projectId: "p1", title: "T", status: "todo", priority: "high", labels: [], source: "jira", currency: "GBP", ...o } as unknown as Issue);

function seed(projects: Project[], issues: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetFxRatesQueryKey(), FX);
  for (const [id, list] of Object.entries(issues)) qc.setQueryData(getGetProjectIssuesQueryKey(id), list);
  return qc;
}

describe("intakeStage", () => {
  it("maps free-form status into the intake funnel stages", () => {
    expect(intakeStage("backlog")).toBe("backlog");
    expect(intakeStage("idea")).toBe("backlog");
    expect(intakeStage("todo")).toBe("triaged");
    expect(intakeStage("open")).toBe("triaged");
    expect(intakeStage("approved")).toBe("approved");
    expect(intakeStage("in_progress")).toBe("delivery");
    expect(intakeStage("in_review")).toBe("delivery");
    expect(intakeStage("done")).toBe("done");
    expect(intakeStage("released")).toBe("done");
  });

  it("drops requests that fell out of the funnel and unset status", () => {
    expect(intakeStage("cancelled")).toBeNull();
    expect(intakeStage("rejected")).toBeNull();
    expect(intakeStage("won't do")).toBeNull();
    expect(intakeStage(null)).toBeNull();
    expect(intakeStage("")).toBeNull();
  });
});

describe("rollupDemandIntake", () => {
  const items = (list: Record<string, unknown>[]): ProjectItems => ({ projectId: "a", projectName: "A", programmeId: null, programmeName: null, currency: "GBP", items: list as unknown as ProjectItems["items"] });

  it("counts the funnel, ranks the queue by RICE then WSJF, and rolls up totals", () => {
    const roll = rollupDemandIntake([
      items([
        { id: "1", status: "backlog", riceScore: 20, requester: "ann" },
        { id: "2", status: "approved", riceScore: 90, wsjf: 12, moscow: "must", strategicContribution: 80, requester: "bob" },
        { id: "3", status: "approved", riceScore: 50, moscow: "should" },
        { id: "4", status: "in_progress", wsjf: 30 },
        { id: "5", status: "done", riceScore: 40 },
        { id: "6", status: "cancelled", riceScore: 999 }, // out of funnel — excluded
      ]),
    ]);

    // Every stage present in flow order, cancelled excluded.
    expect(roll.stages.map((s) => s.key)).toEqual(["backlog", "triaged", "approved", "delivery", "done"]);
    expect(roll.stages.find((s) => s.key === "approved")!.count).toBe(2);
    expect(roll.stages.find((s) => s.key === "triaged")!.count).toBe(0);

    // 5 live demand items (cancelled dropped).
    expect(roll.totals.demand).toBe(5);
    expect(roll.totals.approvedNotStarted).toBe(2);
    // mean RICE over the 4 items that report it: (20 + 90 + 50 + 40) / 4 = 50.
    expect(roll.totals.meanRice).toBe(50);

    // Highest RICE first (90, 50, 40, 20, then the WSJF-only item); item 6 never appears (out of funnel).
    expect(roll.queue.map((r) => r.id)).toEqual(["2", "3", "5", "1", "4"]);
    const top = roll.queue[0]!;
    expect(top.stageLabel).toBe("Approved");
    expect(top.requester).toBe("bob");
    expect(top.moscowWeight).toBe(100);
    expect(top.strategicContribution).toBe(80);
  });

  it("reads requester/RICE/WSJF/MoSCoW defensively and falls back to assignee for requester", () => {
    const roll = rollupDemandIntake([
      items([{ id: "1", status: "todo", assignee: "carol", strategicContribution: 200, riceScore: Number.NaN }]),
    ]);
    const row = roll.queue[0]!;
    expect(row.requester).toBe("carol"); // no requester → assignee
    expect(row.riceScore).toBeNull(); // NaN dropped, not zeroed
    expect(row.strategicContribution).toBe(100); // clamped into 0–100
    expect(roll.totals.meanRice).toBeNull(); // nothing scored
  });
});

describe("DemandIntake", () => {
  it("renders the intake funnel and prioritised queue", () => {
    renderWithProviders(<DemandIntake />, {
      client: seed([project({ id: "a" })], {
        a: [
          issue({ id: "1", status: "approved", riceScore: 90, moscow: "must", requester: "ann", strategicContribution: 70 }),
          issue({ id: "2", status: "backlog", riceScore: 20, requester: "bob" }),
        ],
      }),
    });
    expect(screen.getByTestId("demand-intake")).toBeInTheDocument();
    expect(screen.getByTestId("demand-intake-funnel")).toBeInTheDocument();
    expect(screen.getByTestId("demand-intake-stage-approved-count")).toHaveTextContent("1");
    // Highest RICE (item 1) leads the queue.
    const row = screen.getByTestId("demand-intake-row-1");
    expect(row).toHaveTextContent("ann");
    expect(row).toHaveTextContent("90");
  });

  it("shows the empty state when no work item carries a live status", () => {
    renderWithProviders(<DemandIntake />, { client: seed([project({ id: "a" })], { a: [issue({ id: "1", status: "cancelled" })] }) });
    expect(screen.getByTestId("demand-intake-empty")).toBeInTheDocument();
  });
});
