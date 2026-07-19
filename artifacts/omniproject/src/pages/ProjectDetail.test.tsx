import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { ProjectDetail } from "./ProjectDetail";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 0,
    completedCount: 0,
    memberCount: 0,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seed(projects: Project[], projectId: string): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  // Pre-seed the board's issues so the generic issue board renders without a network call.
  qc.setQueryData(getGetProjectIssuesQueryKey(projectId), []);
  return qc;
}

describe("ProjectDetail", () => {
  it("renders the project header (identifier, name, source) from the list row", () => {
    renderWithProviders(<ProjectDetail projectId="proj-1" />, { client: seed([project()], "proj-1") });
    expect(screen.getByRole("heading", { level: 1, name: /platform rewrite/i })).toBeInTheDocument();
    expect(screen.getByText("PLT")).toBeInTheDocument();
    // breadcrumb back link to projects index
    expect(screen.getByRole("link", { name: /projects/i })).toHaveAttribute("href", "/projects");
  });

  it("falls back to a generic PROJECT header when the id is not in the list", () => {
    renderWithProviders(<ProjectDetail projectId="unknown" />, { client: seed([project()], "unknown") });
    expect(screen.getByRole("heading", { level: 1, name: /^project$/i })).toBeInTheDocument();
  });
});
