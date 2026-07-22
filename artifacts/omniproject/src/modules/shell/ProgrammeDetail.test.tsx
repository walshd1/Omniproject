import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetProgrammeQueryKey,
  type ProgrammeDetail as ProgrammeDetailType,
  type Project,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { ProgrammeDetail } from "./ProgrammeDetail";

function project(over: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Member Project",
    identifier: "MEM",
    source: "jira",
    issueCount: 10,
    completedCount: 5,
    memberCount: 2,
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function detail(over: Partial<ProgrammeDetailType> = {}): ProgrammeDetailType {
  return {
    id: "prog-1",
    name: "Delivery Programme",
    projectCount: 1,
    issueCount: 10,
    completedCount: 5,
    completionRate: 50,
    ragStatus: "AMBER",
    updatedAt: new Date(0).toISOString(),
    projects: [project()],
    ...over,
  };
}

function seed(id: string, data: ProgrammeDetailType): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetProgrammeQueryKey(id), data);
  return qc;
}

describe("ProgrammeDetail", () => {
  it("renders the programme heading, RAG status, stats and member projects", () => {
    renderWithProviders(<ProgrammeDetail programmeId="prog-1" />, { client: seed("prog-1", detail()) });
    expect(screen.getByRole("heading", { level: 1, name: /delivery programme/i })).toBeInTheDocument();
    expect(screen.getByText("AMBER")).toBeInTheDocument();
    // stats labels
    expect(screen.getByText(/^Completion$/i)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    // member project row
    expect(screen.getByText("Member Project")).toBeInTheDocument();
    expect(screen.getByText(/5\/10 · 50%/)).toBeInTheDocument();
  });

  it("renders a not-found state when the programme is unknown", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // Seed a resolved-but-empty result so the query is not loading and !prog holds.
    qc.setQueryData(getGetProgrammeQueryKey("missing"), null as unknown as ProgrammeDetailType);
    renderWithProviders(<ProgrammeDetail programmeId="missing" />, { client: qc });
    // The not-found state still paints an <h1> (every page owns a heading — the route smoke relies
    // on it), rather than rendering a headingless blank that reads as a broken page.
    expect(screen.getByRole("heading", { level: 1, name: /programme not found/i })).toBeInTheDocument();
  });
});
