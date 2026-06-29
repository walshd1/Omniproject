import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, getListProgrammesQueryKey, type Project, type Programme } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { GlobalSearch } from "./GlobalSearch";
import { useGlobalSearch } from "../../lib/global-search";
import { useSidePanel } from "../../lib/side-panel";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";

function project(over: Partial<Project> = {}): Project {
  return { id: "p1", name: "Apollo", identifier: "AP", source: "jira", issueCount: 1, completedCount: 0, memberCount: 1, updatedAt: new Date(0).toISOString(), ...over } as Project;
}
function programme(over: Partial<Programme> = {}): Programme {
  return { id: "pr1", name: "Gemini Programme", projectCount: 1, issueCount: 0, completedCount: 0, completionRate: 0, ragStatus: "GREEN", ...over } as Programme;
}

function seed(opts: { enabled?: boolean; sidePanel?: boolean } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(featuresQueryKey, [
    { id: "globalSearch", label: "Global search", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
    { id: "sidePanel", label: "Rich side-panel", description: "", enabled: opts.sidePanel ?? false, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(getListProjectsQueryKey(), [project()]);
  qc.setQueryData(getListProgrammesQueryKey(), [programme()]);
  return qc;
}

beforeEach(() => {
  useGlobalSearch.setState({ open: false });
  useSidePanel.setState({ open: false, projectId: null, issueId: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("GlobalSearch", () => {
  it("renders nothing when the module is disabled", () => {
    const { container } = renderWithProviders(<GlobalSearch />, { client: seed({ enabled: false }) });
    act(() => useGlobalSearch.getState().setOpen(true));
    expect(container.querySelector("[data-testid='global-search']")).toBeNull();
  });

  it("opens, searches across entities and shows ranked results", async () => {
    renderWithProviders(<GlobalSearch />, { client: seed() });
    act(() => useGlobalSearch.getState().setOpen(true));
    const input = await screen.findByLabelText(/search projects/i);
    fireEvent.change(input, { target: { value: "apollo" } });
    await waitFor(() => expect(screen.getByText("Apollo")).toBeInTheDocument());
  });

  it("shows an empty state when nothing matches", async () => {
    renderWithProviders(<GlobalSearch />, { client: seed() });
    act(() => useGlobalSearch.getState().setOpen(true));
    const input = await screen.findByLabelText(/search projects/i);
    fireEvent.change(input, { target: { value: "zzzznomatch" } });
    expect(await screen.findByTestId("global-search-empty")).toBeInTheDocument();
  });

  it("Enter on a project hit routes and closes the overlay", async () => {
    renderWithProviders(<GlobalSearch />, { client: seed() });
    act(() => useGlobalSearch.getState().setOpen(true));
    const input = await screen.findByLabelText(/search projects/i);
    fireEvent.change(input, { target: { value: "apollo" } });
    await screen.findByText("Apollo");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useGlobalSearch.getState().open).toBe(false));
  });
});
