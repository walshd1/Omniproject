import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetProjectIssuesQueryKey, getListActivityQueryKey, type Issue, type ActivityEntry } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { IssueSidePanel, buildFieldUpdate } from "./IssueSidePanel";
import { useSidePanel } from "../../lib/side-panel";
import { useRecentItems } from "../../lib/recent-items";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { availabilityQueryKey, type Availability } from "../../lib/availability";

const AVAIL: Availability = {
  source: "capabilities",
  fields: ["title", "status", "priority", "assignee", "dueDate"],
  available: ["title", "status", "priority", "assignee", "dueDate"],
  hidden: [], tables: [], relationships: [],
};

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i1", projectId: "p1", title: "Wire the broker", status: "todo", priority: "high", assignee: "ada", labels: [], source: "jira", version: 4, ...over } as Issue;
}

function seed(opts: { enabled?: boolean; issues?: Issue[]; activity?: ActivityEntry[] } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(featuresQueryKey, [
    { id: "sidePanel", label: "Rich side-panel", description: "", enabled: opts.enabled ?? true, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  qc.setQueryData(availabilityQueryKey, AVAIL);
  qc.setQueryData(getGetProjectIssuesQueryKey("p1"), opts.issues ?? [issue()]);
  qc.setQueryData(getListActivityQueryKey(), opts.activity ?? []);
  return qc;
}

const mutatingCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, o]) => o && /PATCH|PUT|POST/.test((o as RequestInit).method ?? ""));

beforeEach(() => {
  useSidePanel.setState({ open: false, projectId: null, issueId: null });
  useRecentItems.setState({ items: [] });
  vi.stubGlobal("fetch", vi.fn(async (_u: string, o?: RequestInit) =>
    new Response((o?.method ?? "GET") === "GET" ? "[]" : "{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("buildFieldUpdate", () => {
  it("binds expectedVersion only when a version is known", () => {
    expect(buildFieldUpdate("status", "done", 4)).toEqual({ status: "done", expectedVersion: 4 });
    expect(buildFieldUpdate("status", "done", null)).toEqual({ status: "done" });
  });
});

describe("IssueSidePanel", () => {
  it("renders nothing when the module is disabled", () => {
    const { container } = renderWithProviders(<IssueSidePanel />, { client: seed({ enabled: false }) });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    expect(container.querySelector("[data-testid='issue-side-panel']")).toBeNull();
  });

  it("shows the work item's fields when opened", async () => {
    renderWithProviders(<IssueSidePanel />, { client: seed() });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    expect(await screen.findByText("Wire the broker")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Assignee")).toBeInTheDocument();
  });

  it("inline-edits a field through the issue endpoint with the optimistic-concurrency token", async () => {
    renderWithProviders(<IssueSidePanel />, { client: seed() });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    const status = (await screen.findByLabelText("Status")) as HTMLSelectElement;
    fireEvent.change(status, { target: { value: "done" } });
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    const body = String((mutatingCalls().at(-1)![1] as RequestInit).body);
    expect(body).toContain("\"status\":\"done\"");
    expect(body).toContain("expectedVersion");
  });

  it("records the opened work item in the recents quick-find list (findability)", async () => {
    renderWithProviders(<IssueSidePanel />, { client: seed() });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    await screen.findByText("Wire the broker");
    await waitFor(() => expect(useRecentItems.getState().items[0]).toMatchObject({ type: "issue", id: "i1", label: "Wire the broker", projectId: "p1" }));
  });

  // Both arrays are populated on each event: our hook reads `touches` on start / `changedTouches` on
  // end, while Radix's scroll-lock listener also probes them — leaving either undefined makes it throw.
  const startTouch = (panel: HTMLElement, x: number, y: number) =>
    fireEvent.touchStart(panel, { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });
  const endTouch = (panel: HTMLElement, x: number, y: number) =>
    fireEvent.touchEnd(panel, { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }] });

  it("dismisses on a right-swipe (touch affordance), the same close the button/Esc trigger", async () => {
    renderWithProviders(<IssueSidePanel />, { client: seed() });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    const panel = await screen.findByTestId("issue-side-panel");
    startTouch(panel, 20, 40);
    endTouch(panel, 140, 45);
    await waitFor(() => expect(useSidePanel.getState().open).toBe(false));
  });

  it("ignores a vertical scroll gesture (does not dismiss)", async () => {
    renderWithProviders(<IssueSidePanel />, { client: seed() });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    const panel = await screen.findByTestId("issue-side-panel");
    startTouch(panel, 40, 20);
    endTouch(panel, 45, 160);
    expect(useSidePanel.getState().open).toBe(true);
  });

  it("lists only this item's activity", async () => {
    const activity: ActivityEntry[] = [
      { id: "a1", action: "status_changed", actor: "ada", projectId: "p1", issueId: "i1", timestamp: new Date(0).toISOString() } as ActivityEntry,
      { id: "a2", action: "created", actor: "bob", projectId: "p1", issueId: "other", timestamp: new Date(0).toISOString() } as ActivityEntry,
    ];
    renderWithProviders(<IssueSidePanel />, { client: seed({ activity }) });
    act(() => useSidePanel.getState().openIssue("p1", "i1"));
    await screen.findByText("Wire the broker");
    expect(screen.getByTestId("side-panel-activity")).toBeInTheDocument();
    expect(screen.getByText(/ada/)).toBeInTheDocument();
    expect(screen.queryByText(/bob/)).toBeNull(); // other item's activity filtered out
  });
});
