import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import type { DependencyEdge, DependencyType } from "../../lib/dependencies";
import { saveEdges } from "../../lib/dependencies";
import { renderWithProviders } from "../../test/utils";
import { AutoScheduleForecast } from "./AutoScheduleForecast";
import { projectDependenciesQueryKey, type BrokeredDependency } from "../../lib/project-dependencies";

/**
 * The auto-schedule forecast report — renders the pure engine's projection over live issues + the
 * dependency overlay. The forecast maths itself is unit-tested in lib/project-forecast.test; here we just
 * check the component wires fetch → engine → table and its empty/cycle states.
 */
function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", ...over } as Issue;
}
function edge(from: string, to: string, type: DependencyType = "blocks", project = "p1"): DependencyEdge {
  return {
    schema: 1, edgeKey: `${from}-${type}-${to}`,
    from: { system: "jira", projectRef: project, itemRef: from },
    to: { system: "jira", projectRef: project, itemRef: to },
    type, fromHash: "x", toHash: "y", assertedAt: "2026-01-01T00:00:00Z",
  };
}
function seed(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), issues);
  return qc;
}

// The component reads edges from the dependency overlay (loadEdges); seed/clear it per test.
function withEdges(edges: DependencyEdge[]): void {
  saveEdges(edges);
}

describe("AutoScheduleForecast", () => {
  const issues = [
    issue({ id: "a", title: "Design", estimateHours: 16 }), // 2 working days
    issue({ id: "b", title: "Build", estimateHours: 40 }), // 5 working days
  ];

  it("renders the forecast table with driver attribution from durations + blocks edges", () => {
    withEdges([edge("a", "b")]);
    renderWithProviders(<AutoScheduleForecast projectId="p1" />, { client: seed(issues) });
    expect(screen.getByTestId("auto-schedule-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-row-a")).toBeInTheDocument();
    const rowB = screen.getByTestId("forecast-row-b");
    expect(rowB).toHaveTextContent("Design"); // B is driven by A
    expect(screen.getByTestId("forecast-violations")).toHaveTextContent("0");
  });

  it("drives the forecast from durable brokered edges, not just the volatile overlay (§5.5 slice 3)", () => {
    withEdges([]); // no volatile edges — the precedence comes purely from the brokered graph
    const client = seed(issues);
    const brokered: BrokeredDependency[] = [{ fromId: "a", toId: "b", kind: "blocks" }];
    client.setQueryData(projectDependenciesQueryKey("p1"), { edges: brokered });
    renderWithProviders(<AutoScheduleForecast projectId="p1" />, { client });
    expect(screen.getByTestId("forecast-row-b")).toHaveTextContent("Design"); // B driven by A via the brokered edge
  });

  it("shows the empty state when there is no work to forecast", () => {
    withEdges([]);
    renderWithProviders(<AutoScheduleForecast projectId="p1" />, { client: seed([]) });
    expect(screen.getByTestId("forecast-empty")).toBeInTheDocument();
  });

  it("warns (but still places every activity) on a dependency cycle", () => {
    withEdges([edge("a", "b"), edge("b", "a")]);
    renderWithProviders(<AutoScheduleForecast projectId="p1" />, { client: seed(issues) });
    expect(screen.getByTestId("forecast-cycle")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-row-a")).toBeInTheDocument();
    expect(screen.getByTestId("forecast-row-b")).toBeInTheDocument();
  });
});
