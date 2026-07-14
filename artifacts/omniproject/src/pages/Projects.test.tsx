import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@workspace/api-client-react";
import { renderWithProviders } from "../test/utils";
import { usePredictivePrefetchSetting } from "../lib/prefetch";
import { featuresQueryKey, type FeatureStatus } from "../lib/features";
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

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

afterEach(() => {
  vi.restoreAllMocks();
  usePredictivePrefetchSetting.setState({ enabled: false });
});

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

  it("shows the loading skeleton while the project list is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves ⇒ stays loading
    const { container } = renderWithProviders(<Projects />, { client: freshClient() });
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("shows an error state on query failure and refetches when Retry is clicked", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<Projects />, { client: freshClient() });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("opens the new-project dialog when 'New Project' is clicked", async () => {
    renderWithProviders(<Projects />, { client: seeded([project()]) });
    fireEvent.click(screen.getByRole("button", { name: /new project/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("warms a project's issues immediately on focus, and hover/leave don't throw", async () => {
    const fetchMock = vi.fn(
      async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<Projects />, { client: seeded([project()]) });
    const card = screen.getByText("Platform Rewrite").closest(".group") as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    fireEvent.focus(card);
    await waitFor(() => {
      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const urls = calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/projects/proj-1/issues"))).toBe(true);
    });
  });

  it("warms every listed project when predictive prefetch is active", async () => {
    usePredictivePrefetchSetting.setState({ enabled: true });
    const fetchMock = vi.fn(
      async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const qc = seeded([project({ id: "p1" }), project({ id: "p2", name: "Second" })]);
    qc.setQueryData(featuresQueryKey(), [
      { id: "predictivePrefetch", kind: "module", label: "Predictive loading", description: "", enabled: true, loaded: true, needsRestart: false },
    ] satisfies FeatureStatus[]);
    renderWithProviders(<Projects />, { client: qc });
    await waitFor(() => {
      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const urls = calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/projects/p1/issues"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/projects/p2/issues"))).toBe(true);
    });
  });
});
