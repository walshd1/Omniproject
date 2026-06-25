import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getListActivityQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type ActivityEntry,
} from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { useStore } from "../store/useStore";
import { Home } from "./Home";

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

function activity(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: "act-1",
    action: "issue_created",
    actor: "Ada",
    projectId: "proj-1",
    issueId: "iss-1",
    issueTitle: "Wire the broker",
    detail: null,
    timestamp: new Date(0).toISOString(),
    ...over,
  };
}

beforeEach(() => {
  // Reset the persisted store between cases so activeProjectId doesn't leak.
  useStore.setState({ activeProjectId: null, currentView: "kanban" });
});

describe("Home dashboard", () => {
  it("shows the 'no projects yet' empty state when the list is empty", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), []);
    qc.setQueryData(getListActivityQueryKey(), []);
    renderWithProviders(<Home />, { client: qc });
    expect(screen.getByRole("heading", { level: 1, name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("auto-activates the first project and renders the active view + activity feed", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), [project()]);
    qc.setQueryData(getListActivityQueryKey(), [activity()]);
    // Seed the kanban board's issues so the auto-mounted ActiveView doesn't fetch.
    qc.setQueryData(getGetProjectIssuesQueryKey("proj-1"), []);
    renderWithProviders(<Home />, { client: qc });
    // Active project selector reflects the auto-selected project.
    expect(screen.getByLabelText(/active project/i)).toBeInTheDocument();
    // Activity feed entry rendered.
    expect(screen.getByText(/wire the broker/i)).toBeInTheDocument();
    expect(screen.getByText(/issue created/i)).toBeInTheDocument();
  });

  it("renders an error state when the projects query fails", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = getListProjectsQueryKey();
    // Force the projects query into an error state.
    qc.setQueryData(getListActivityQueryKey(), []);
    const observer = qc.getQueryCache().build(qc, { queryKey: key });
    observer.setState({
      status: "error",
      error: new Error("boom"),
      fetchStatus: "idle",
    } as never);
    renderWithProviders(<Home />, { client: qc });
    expect(screen.getByRole("heading", { level: 1, name: /dashboard/i })).toBeInTheDocument();
  });
});
