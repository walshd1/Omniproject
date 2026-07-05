import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getListProgrammesQueryKey,
  getListActivityQueryKey,
  getGetProjectCapacityQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type Programme,
  type ActivityEntry,
  type ResourceCapacity,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { WidgetView, WIDGET_COMPONENTS } from "./widgets";

/**
 * The registry (WIDGET_COMPONENTS/WidgetView dispatch) and every widget component that
 * isn't already exercised by its own test file (PortfolioKpi.test.tsx, PortfolioTrends.test.tsx
 * cover portfolioHealth/portfolioTrends) — none of these had any coverage before.
 */
function makeQC(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
}

describe("WidgetView dispatch", () => {
  it("renders the registered component for a known widget type", () => {
    const qc = makeQC();
    qc.setQueryData(getListProjectsQueryKey(), [] as Project[]);
    renderWithProviders(<WidgetView type="projectCount" />, { client: qc });
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("falls back to the unknown-widget placeholder for an unrecognized type", () => {
    renderWithProviders(<WidgetView type="removedWidget" />, { client: makeQC() });
    expect(screen.getByText(/Unknown widget/)).toHaveTextContent("Unknown widget “removedWidget”");
  });

  it("registers exactly the catalogue's widget types", () => {
    expect(Object.keys(WIDGET_COMPONENTS).sort()).toEqual(
      ["capacityActuals", "portfolioHealth", "portfolioTrends", "programmeCount", "projectCount", "recentActivity", "statusBreakdown"].sort(),
    );
  });
});

describe("ProjectCountWidget", () => {
  it("shows the project count and links to /projects", () => {
    const qc = makeQC();
    qc.setQueryData(getListProjectsQueryKey(), [{ id: "p1" }, { id: "p2" }] as unknown as Project[]);
    renderWithProviders(<WidgetView type="projectCount" />, { client: qc });
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/projects");
  });

  it("shows an em dash while the count is unknown (no cached data)", () => {
    renderWithProviders(<WidgetView type="projectCount" />, { client: makeQC() });
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("ProgrammeCountWidget", () => {
  it("shows the programme count and links to /programmes", () => {
    const qc = makeQC();
    qc.setQueryData(getListProgrammesQueryKey(), [{ id: "g1" }] as unknown as Programme[]);
    renderWithProviders(<WidgetView type="programmeCount" />, { client: qc });
    expect(screen.getByText("Programmes")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/programmes");
  });
});

describe("StatusBreakdownWidget", () => {
  it("shows the empty state when there are no projects", () => {
    const qc = makeQC();
    qc.setQueryData(getListProjectsQueryKey(), [] as Project[]);
    renderWithProviders(<WidgetView type="statusBreakdown" />, { client: qc });
    expect(screen.getByText("No projects.")).toBeInTheDocument();
  });

  it("counts projects per status, most common first, defaulting to unknown", () => {
    const qc = makeQC();
    qc.setQueryData(getListProjectsQueryKey(), [
      { id: "p1", status: "active" },
      { id: "p2", status: "active" },
      { id: "p3", status: "on_hold" },
      { id: "p4" }, // no status at all
    ] as unknown as Project[]);
    renderWithProviders(<WidgetView type="statusBreakdown" />, { client: qc });
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    // "active" (2) sorts before "on_hold" (1) and the unknown bucket (1).
    expect(rows[0]).toHaveTextContent("2");
  });
});

describe("RecentActivityWidget", () => {
  function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
    return {
      id: "a1", projectId: "p1", actor: "Alice", action: "created_issue",
      timestamp: "2026-01-15T10:30:00.000Z", ...over,
    } as ActivityEntry;
  }

  it("shows the empty state when there is no activity", () => {
    const qc = makeQC();
    qc.setQueryData(getListActivityQueryKey(), [] as ActivityEntry[]);
    renderWithProviders(<WidgetView type="recentActivity" />, { client: qc });
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("renders each entry's actor, humanised action, and issue title when present", () => {
    const qc = makeQC();
    qc.setQueryData(getListActivityQueryKey(), [
      entry({ id: "a1", actor: "Alice", action: "created_issue", issueTitle: "Ship the export" }),
      entry({ id: "a2", actor: "Bob", action: "closed_issue", issueTitle: null }),
    ]);
    renderWithProviders(<WidgetView type="recentActivity" />, { client: qc });
    expect(screen.getByText("Alice created issue")).toBeInTheDocument();
    expect(screen.getByText("Ship the export")).toBeInTheDocument();
    expect(screen.getByText("Bob closed issue")).toBeInTheDocument();
  });

  it("shows only the 8 most recent entries", () => {
    const qc = makeQC();
    const entries = Array.from({ length: 10 }, (_, i) => entry({ id: `a${i}`, actor: `User${i}` }));
    qc.setQueryData(getListActivityQueryKey(), entries);
    renderWithProviders(<WidgetView type="recentActivity" />, { client: qc });
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
  });
});

describe("CapacityActualsWidget", () => {
  function seedCapacity(qc: QueryClient, projectIds: string[]) {
    qc.setQueryData(getListProjectsQueryKey(), projectIds.map((id) => ({ id })) as unknown as Project[]);
  }

  it("shows the empty state when there is no capacity or logged-time data", () => {
    const qc = makeQC();
    seedCapacity(qc, ["p1"]);
    qc.setQueryData(getGetProjectCapacityQueryKey("p1"), [] as ResourceCapacity[]);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [] as Issue[]);
    renderWithProviders(<WidgetView type="capacityActuals" />, { client: qc });
    expect(screen.getByText("No capacity or logged-time data to compare.")).toBeInTheDocument();
  });

  it("joins plan to logged actuals per resource and rolls up the overall delivery percentage", () => {
    const planned = 40;
    const logged = 50;
    const qc = makeQC();
    seedCapacity(qc, ["p1"]);
    qc.setQueryData(getGetProjectCapacityQueryKey("p1"), [
      {
        resourceId: "alice", resourceName: "Alice", role: "Engineer",
        allocationPercentage: 100, assignedHours: planned, availableHours: planned, utilizationState: "OPTIMAL",
      },
    ] as ResourceCapacity[]);
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [
      { id: "i1", projectId: "p1", assignee: "alice", loggedHours: logged },
    ] as unknown as Issue[]);
    renderWithProviders(<WidgetView type="capacityActuals" />, { client: qc });

    expect(screen.getByText(`${Math.round((logged / planned) * 100)}%`)).toBeInTheDocument();
    expect(screen.getByText(`${logged}h logged / ${planned}h planned`)).toBeInTheDocument();
    const row = screen.getByTestId("capacity-actuals-row-alice");
    expect(row).toHaveTextContent("Alice");
    expect(row).toHaveTextContent(`${logged}h/${planned}h`);
    expect(row).toHaveTextContent(`+${logged - planned}h`); // over-delivered
  });
});
