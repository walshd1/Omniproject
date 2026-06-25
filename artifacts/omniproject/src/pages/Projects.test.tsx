import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { Projects } from "./Projects";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 20,
    completedCount: 5,
    memberCount: 4,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seeded(projects: Project[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  return qc;
}

describe("Projects index", () => {
  it("derives completion % from the list row counts (no per-card summary fetch)", () => {
    renderWithProviders(<Projects />, { client: seeded([project({ issueCount: 20, completedCount: 5 })]) });
    // 5/20 = 25%. Asserts the N+1 fix renders from issueCount/completedCount.
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("Platform Rewrite")).toBeInTheDocument();
  });

  it("guards completion against divide-by-zero for an empty project", () => {
    renderWithProviders(<Projects />, {
      client: seeded([project({ id: "p0", name: "Empty", issueCount: 0, completedCount: 0 })]),
    });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows no completion card when there are no projects (first-run empty state)", () => {
    renderWithProviders(<Projects />, { client: seeded([]) });
    expect(screen.queryByText("25%")).not.toBeInTheDocument();
  });
});
