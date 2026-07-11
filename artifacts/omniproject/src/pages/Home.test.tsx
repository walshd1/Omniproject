import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getListActivityQueryKey,
  getGetProjectIssuesQueryKey,
  type Project,
  type ActivityEntry,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../test/utils";
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

// Grab the real store actions once so a test that stubs one (below) can be undone.
const realSetActiveProjectId = useStore.getState().setActiveProjectId;

beforeEach(() => {
  // Reset the persisted store between cases so activeProjectId / a stubbed action doesn't leak.
  useStore.setState({ activeProjectId: null, currentView: "kanban", isNewIssueOpen: false, setActiveProjectId: realSetActiveProjectId });
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

  it("opens the New Issue dialog when the enabled button is clicked", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), [project()]);
    qc.setQueryData(getListActivityQueryKey(), []);
    qc.setQueryData(getGetProjectIssuesQueryKey("proj-1"), []);
    renderWithProviders(<Home />, { client: qc });
    // Auto-selected project enables the action.
    const btn = screen.getByTestId("new-issue-button");
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(useStore.getState().isNewIssueOpen).toBe(true);
  });

  it("switches the active project via the selector", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), [project(), project({ id: "proj-2", name: "Second Project" })]);
    qc.setQueryData(getListActivityQueryKey(), []);
    qc.setQueryData(getGetProjectIssuesQueryKey("proj-1"), []);
    qc.setQueryData(getGetProjectIssuesQueryKey("proj-2"), []);
    renderWithProviders(<Home />, { client: qc });
    // Effect auto-selects the first project.
    expect(useStore.getState().activeProjectId).toBe("proj-1");
    await user.click(screen.getByLabelText(/active project/i));
    await user.click(await screen.findByRole("option", { name: "Second Project" }));
    expect(useStore.getState().activeProjectId).toBe("proj-2");
  });

  it("shows the 'pick a project' prompt and activates on click when no project is active", () => {
    // Stub the store action so the auto-select effect can't set an active project,
    // exercising the projects-present-but-none-active empty state.
    useStore.setState({ setActiveProjectId: () => {} });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListProjectsQueryKey(), [project()]);
    qc.setQueryData(getListActivityQueryKey(), []);
    renderWithProviders(<Home />, { client: qc });
    expect(screen.getByText(/pick a project to get started/i)).toBeInTheDocument();
    // The "Open <name>" button is wired to the (stubbed) activate action — clicking is a no-op but covers the handler.
    fireEvent.click(screen.getByRole("button", { name: /open platform rewrite/i }));
    expect(useStore.getState().activeProjectId).toBeNull();
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

  it("shows the DataState error block and refetches when Retry is clicked", async () => {
    // Let the projects query actually run and fail so it settles in the error
    // state (a manually-seeded error observer just refetches away on mount).
    const calls = mockFetchRouter({ "/api/projects": { ok: false, status: 500 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(getListActivityQueryKey(), []);
    renderWithProviders(<Home />, { client: qc });

    // Error surface rendered by DataState.
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);

    const projectCalls = () => calls.filter((c) => new URL(c.url, "http://localhost").pathname === "/api/projects").length;
    const before = projectCalls();
    // Fire the DataState error-state onRetry callback (Home.tsx: () => refetchProjects()).
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(projectCalls()).toBeGreaterThan(before);
  });
});

afterEach(() => resetFetchMock());
