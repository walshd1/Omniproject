import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetCapabilitiesQueryKey,
  type Project,
  type Capabilities,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { Reports } from "./Reports";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Platform Rewrite",
    identifier: "PLT",
    source: "jira",
    issueCount: 10,
    completedCount: 5,
    memberCount: 3,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function caps(over: Partial<Capabilities> = {}): Capabilities {
  // Default everything to false so the Gated wrappers render their
  // "not available" message instead of mounting fetching report children.
  return {
    mode: "demo",
    issues: false,
    scheduling: false,
    resources: false,
    financials: false,
    portfolio: false,
    baseline: false,
    blockers: false,
    history: false,
    raid: false,
    quality: false,
    crm: false,
    service: false,
    benefits: false,
    stakeholders: false,
    raci: false,
    timeTravel: false,
    ...over,
  };
}

function seed(projects: Project[], c: Capabilities | undefined): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  if (c) qc.setQueryData(getGetCapabilitiesQueryKey(), c);
  return qc;
}

describe("Reports", () => {
  it("renders the reporting title and a project selector when projects exist", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps()) });
    expect(screen.getByRole("heading", { level: 1, name: /enterprise reporting/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/report project/i)).toBeInTheDocument();
  });

  it("gates report sections that the backend cannot populate", () => {
    renderWithProviders(<Reports />, { client: seed([project()], caps()) });
    // Every domain is false → each Gated section shows its dependency message.
    const gated = screen.getAllByText(/not available for this backend/i);
    expect(gated.length).toBeGreaterThanOrEqual(1);
  });

  it("renders without a project selector when there are no projects", () => {
    renderWithProviders(<Reports />, { client: seed([], caps()) });
    expect(screen.getByRole("heading", { level: 1, name: /enterprise reporting/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/report project/i)).not.toBeInTheDocument();
  });
});
