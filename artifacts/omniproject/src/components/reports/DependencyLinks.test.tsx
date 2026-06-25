import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { DependencyLinks } from "./DependencyLinks";
import { createEdge, saveEdges, type ItemRef } from "../../lib/dependencies";

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 2, completedCount: 0, memberCount: 1, updatedAt: "" },
  { id: "p2", name: "Beta", identifier: "BE", source: "servicenow", issueCount: 2, completedCount: 0, memberCount: 1, updatedAt: "" },
] as unknown as Project[];

function seeded(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, enabled: false } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("DependencyLinks", () => {
  it("shows the empty state and the captured-provenance badge", () => {
    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByTestId("dep-empty")).toBeInTheDocument();
    expect(screen.getByText(/captured/i)).toBeInTheDocument();
  });

  it("renders a previously-linked edge from the session (refs only, no content)", async () => {
    const from: ItemRef = { system: "jira", projectRef: "p1", itemRef: "a-1" };
    const to: ItemRef = { system: "servicenow", projectRef: "p2", itemRef: "b-9" };
    const edge = await createEdge(from, to, "blocks", { status: "open", title: "secret" }, { status: "new", title: "hidden" });
    saveEdges([edge]);

    renderWithProviders(<DependencyLinks />, { client: seeded() });
    expect(screen.getByLabelText("Dependency edges")).toBeInTheDocument();
    expect(screen.getByText("jira:a-1")).toBeInTheDocument();
    expect(screen.getByText("servicenow:b-9")).toBeInTheDocument();
    // Anti-creep: the stored/rendered edge carries no item content.
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument();
  });
});
