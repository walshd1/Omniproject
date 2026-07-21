import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import type { DependencyEdge, DependencyType } from "../../lib/dependencies";
import { renderWithProviders } from "../../test/utils";
import { CriticalPath, durationDays, toCpmEdges } from "./CriticalPath";
import { projectDependenciesQueryKey, type DependencyRow } from "../../lib/project-dependencies";

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

describe("durationDays", () => {
  it("uses an inclusive start→due span in days when both dates exist", () => {
    expect(durationDays({ startDate: "2026-03-01", dueDate: "2026-03-05", estimateHours: null })).toBe(5);
  });
  it("falls back to estimate ÷ 8h and clamps to at least a day", () => {
    expect(durationDays({ startDate: null, dueDate: null, estimateHours: 40 })).toBe(5);
    expect(durationDays({ startDate: null, dueDate: null, estimateHours: 2 })).toBe(1);
  });
  it("returns 0 for an undated, unestimated milestone", () => {
    expect(durationDays({ startDate: null, dueDate: null, estimateHours: null })).toBe(0);
  });
});

describe("toCpmEdges", () => {
  const ids = new Set(["a", "b"]);
  it("maps blocks to forward precedence and depends_on to the reverse", () => {
    expect(toCpmEdges([edge("a", "b", "blocks")], "p1", ids)).toEqual([{ from: "a", to: "b" }]);
    expect(toCpmEdges([edge("a", "b", "depends_on")], "p1", ids)).toEqual([{ from: "b", to: "a" }]);
  });
  it("drops relates_to, cross-project edges, and edges to unknown items", () => {
    expect(toCpmEdges([edge("a", "b", "relates_to")], "p1", ids)).toEqual([]);
    expect(toCpmEdges([edge("a", "b", "blocks", "other")], "p1", ids)).toEqual([]);
    expect(toCpmEdges([edge("a", "ghost", "blocks")], "p1", ids)).toEqual([]);
  });
});

describe("CriticalPath", () => {
  const issues = [
    issue({ id: "a", title: "Design", estimateHours: 16 }),   // 2d
    issue({ id: "b", title: "Build", estimateHours: 40 }),    // 5d
    issue({ id: "c", title: "Test", estimateHours: 8 }),      // 1d
  ];

  it("computes and renders the critical chain from durations + blocks edges", () => {
    renderWithProviders(
      <CriticalPath projectId="p1" edges={[edge("a", "b"), edge("b", "c")]} />,
      { client: seed(issues) },
    );
    expect(screen.getByTestId("critical-path")).toBeInTheDocument();
    // a(2)+b(5)+c(1) = 8 working days end to end.
    expect(screen.getByTestId("cpm-duration")).toHaveTextContent("8");
    const chain = screen.getByTestId("cpm-chain");
    expect(chain).toHaveTextContent("Design");
    expect(chain).toHaveTextContent("Build");
    expect(chain).toHaveTextContent("Test");
  });

  it("shows the empty state when there is no precedence to analyse", () => {
    renderWithProviders(<CriticalPath projectId="p1" edges={[]} />, { client: seed(issues) });
    expect(screen.getByTestId("cpm-empty")).toBeInTheDocument();
  });

  it("warns about a dependency cycle instead of hanging", () => {
    renderWithProviders(
      <CriticalPath projectId="p1" edges={[edge("a", "b"), edge("b", "a")]} />,
      { client: seed(issues) },
    );
    expect(screen.getByTestId("cpm-cycle")).toBeInTheDocument();
  });

  it("derives the chain from the durable dependencies slot when no edges prop is supplied (§5.5)", () => {
    // Seed the generic dependencies-slot rows query ({fromId,toId,kind}) — the component adapts + merges it.
    const client = seed(issues);
    const rows: DependencyRow[] = [{ fromId: "a", toId: "b", kind: "blocks" }, { fromId: "b", toId: "c", kind: "blocks" }];
    client.setQueryData(projectDependenciesQueryKey("p1"), { rows });
    renderWithProviders(<CriticalPath projectId="p1" />, { client });
    expect(screen.getByTestId("cpm-duration")).toHaveTextContent("8");
    const chain = screen.getByTestId("cpm-chain");
    expect(chain).toHaveTextContent("Design");
    expect(chain).toHaveTextContent("Build");
    expect(chain).toHaveTextContent("Test");
  });
});
