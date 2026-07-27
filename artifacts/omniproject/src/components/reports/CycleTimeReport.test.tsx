import { describe, it, expect, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { renderWithProviders, resetFetchMock } from "../../test/utils";
import { CycleTimeReport } from "./CycleTimeReport";

const DAY = 86_400_000;
const T0 = Date.parse("2026-01-01T00:00:00Z");
const iso = (offsetDays: number) => new Date(T0 + offsetDays * DAY).toISOString();

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "i", projectId: "p1", title: "T", status: "todo", priority: "medium", labels: [], source: "jira",
    createdAt: iso(0), updatedAt: iso(0), ...over,
  } as Issue;
}

function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

afterEach(() => resetFetchMock());

describe("CycleTimeReport", () => {
  it("shows the lead-time distribution over completed items", () => {
    renderWithProviders(<CycleTimeReport projectId="p1" />, {
      client: seed([
        issue({ id: "a", status: "done", createdAt: iso(0), updatedAt: iso(4) }), // lead 4d
        issue({ id: "b", status: "done", createdAt: iso(0), updatedAt: iso(6) }), // lead 6d
      ]),
    });
    expect(screen.getByTestId("cycle-time")).toBeInTheDocument();
    const lead = screen.getByTestId("lead-time");
    expect(lead).toHaveTextContent("2 items");
    expect(lead).toHaveTextContent(/p85/);
  });

  it("shows cycle time only for done items that have a start date", () => {
    renderWithProviders(<CycleTimeReport projectId="p1" />, {
      client: seed([issue({ id: "a", status: "done", createdAt: iso(0), startDate: iso(1), updatedAt: iso(5) })]),
    });
    const cycle = screen.getByTestId("cycle-time-panel");
    expect(cycle).toHaveTextContent("1 items"); // started iso(1) → done iso(5) = 4d
  });

  it("ignores non-done items (they have no completed flow time)", () => {
    renderWithProviders(<CycleTimeReport projectId="p1" />, {
      client: seed([issue({ id: "a", status: "in_progress", createdAt: iso(0), updatedAt: iso(3) })]),
    });
    expect(screen.getByTestId("cycle-time-empty")).toBeInTheDocument();
  });

  it("shows the empty state with no completed work items", () => {
    renderWithProviders(<CycleTimeReport projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("cycle-time-empty")).toBeInTheDocument();
  });
});
