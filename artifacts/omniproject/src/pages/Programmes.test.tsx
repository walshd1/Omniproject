import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProgrammesQueryKey,
  getListProjectsQueryKey,
  type Programme,
  type Project,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { programmeRegistryQueryKey, type ProgrammeRegistry } from "../lib/programme-registry";
import { Programmes } from "./Programmes";

function programme(over: Partial<Programme> = {}): Programme {
  return {
    id: "prog-1",
    name: "Platform Programme",
    projectCount: 2,
    issueCount: 40,
    completedCount: 20,
    completionRate: 50,
    ragStatus: "GREEN",
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Standalone Alpha",
    identifier: "ALP",
    source: "jira",
    issueCount: 10,
    completedCount: 4,
    memberCount: 2,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seed(programmes: Programme[], projects: Project[], registry: ProgrammeRegistry = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProgrammesQueryKey(), programmes);
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(programmeRegistryQueryKey, registry);
  return qc;
}

describe("Programmes index", () => {
  it("renders a programme card with its roll-up stats", () => {
    renderWithProviders(<Programmes />, { client: seed([programme()], []) });
    expect(screen.getByRole("heading", { level: 1, name: /programmes/i })).toBeInTheDocument();
    expect(screen.getByText("Platform Programme")).toBeInTheDocument();
    expect(screen.getByText("GREEN")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("lists standalone (ungrouped) projects in their own section", () => {
    renderWithProviders(<Programmes />, {
      client: seed([], [project({ programmeId: null })]),
    });
    expect(screen.getByText(/standalone projects \(1\)/i)).toBeInTheDocument();
    expect(screen.getByText("Standalone Alpha")).toBeInTheDocument();
    expect(screen.getByText("4/10")).toBeInTheDocument();
  });

  it("shows the empty-state message when there are no programmes", () => {
    renderWithProviders(<Programmes />, { client: seed([], []) });
    expect(screen.getByText(/no programmes/i)).toBeInTheDocument();
  });

  it("offers the data-source overlay (completeness + export) over the rollup", () => {
    renderWithProviders(<Programmes />, { client: seed([programme()], []) });
    expect(screen.getByTestId("data-provenance")).toBeInTheDocument();
  });

  it("excludes projects that already belong to a programme (by GUID) from the standalone list", () => {
    const grouped = { ...project({ id: "p2", name: "Grouped Beta" }), omniInstanceId: "g-beta" } as Project;
    renderWithProviders(<Programmes />, {
      client: seed([programme()], [grouped], { "prog-1": { name: "Platform Programme", instanceIds: ["g-beta"] } }),
    });
    expect(screen.queryByText(/standalone projects/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Grouped Beta")).not.toBeInTheDocument();
  });
});
