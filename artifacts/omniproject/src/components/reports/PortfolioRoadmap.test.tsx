import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type Issue,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { PortfolioRoadmap } from "./PortfolioRoadmap";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "p1", name: "Project", identifier: "p1", source: "jira",
    issueCount: 4, completedCount: 1, memberCount: 2, updatedAt: "2026-01-01T00:00:00Z", ...over,
  } as Project;
}

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i", projectId: "p1", title: "Task", status: "todo", priority: "high", labels: [], source: "jira", ...over } as Issue;
}

function seed(projects: Project[], issuesByProject: Record<string, Issue[]>): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  for (const [pid, issues] of Object.entries(issuesByProject)) {
    qc.setQueryData(getGetProjectIssuesQueryKey(pid), issues);
  }
  return qc;
}

describe("PortfolioRoadmap", () => {
  it("renders a programme swimlane with a dated project bar derived from its issues", () => {
    const projects = [
      project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Transformation" }),
      project({ id: "b", name: "Bravo" }), // standalone
    ];
    renderWithProviders(<PortfolioRoadmap />, {
      client: seed(projects, {
        a: [issue({ projectId: "a", startDate: "2026-02-01", dueDate: "2026-04-01" })],
        b: [issue({ projectId: "b", startDate: "2026-03-01", dueDate: "2026-05-01" })],
      }),
    });
    expect(screen.getByTestId("portfolio-roadmap")).toBeInTheDocument();
    expect(screen.getByText("Transformation")).toBeInTheDocument();
    expect(screen.getByText("Standalone projects")).toBeInTheDocument();
    expect(screen.getByTestId("roadmap-bar-a")).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 projects placed/i)).toBeInTheDocument();
  });

  it("reports projects without dated work in the footnote instead of dropping them silently", () => {
    const projects = [
      project({ id: "a", name: "Alpha", programmeId: "prog-1", programmeName: "Transformation" }),
      project({ id: "b", name: "Bravo" }),
    ];
    renderWithProviders(<PortfolioRoadmap />, {
      client: seed(projects, {
        a: [issue({ projectId: "a", startDate: "2026-02-01", dueDate: "2026-04-01" })],
        b: [issue({ projectId: "b" })], // no dates → excluded
      }),
    });
    expect(screen.getByText(/1 of 2 projects placed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 without dated work is not shown/i)).toBeInTheDocument();
  });

  it("shows the empty state when no project has any dated work", () => {
    renderWithProviders(<PortfolioRoadmap />, {
      client: seed([project({ id: "a", name: "Alpha" })], { a: [issue({ projectId: "a" })] }),
    });
    expect(screen.getByTestId("roadmap-empty")).toBeInTheDocument();
  });
});
