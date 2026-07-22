import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getGetProjectIssuesQueryKey,
  getGetCapabilitiesQueryKey,
  type Issue,
  type Capabilities,
} from "@workspace/api-client-react";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { saveEdges, type DependencyEdge } from "../../lib/dependencies";
import { GanttChart } from "./GanttChart";

const PROJECT_ID = "proj-1";
const DAY_MS = 1000 * 60 * 60 * 24;

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "iss-1",
    projectId: PROJECT_ID,
    title: "Design API",
    description: null,
    status: "todo",
    priority: "medium",
    assignee: null,
    labels: [],
    startDate: null,
    dueDate: null,
    source: "jira",
    version: null,
    lastUpdatedBy: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...over,
  };
}

function seeded(issues: Issue[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetProjectIssuesQueryKey(PROJECT_ID), issues);
  return qc;
}

describe("GanttChart", () => {
  it("renders the empty state when no issues have dates", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([issue({ startDate: null, dueDate: null })]),
    });
    expect(screen.getByText(/No scheduled issues/i)).toBeInTheDocument();
  });

  it("renders the empty state when there are no issues at all", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: seeded([]) });
    expect(screen.getByText(/No scheduled issues/i)).toBeInTheDocument();
  });

  it("renders a lane/bar for each scheduled issue", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([
        issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) }),
        issue({ id: "b", title: "Build UI", startDate: isoDaysFromNow(3), dueDate: isoDaysFromNow(8) }),
      ]),
    });
    expect(screen.getByRole("button", { name: "Design API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build UI" })).toBeInTheDocument();
    // Header axis labels present.
    expect(screen.getByText("Issue")).toBeInTheDocument();
  });

  it("includes an issue that has only a due date", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([issue({ id: "c", title: "Ship release", startDate: null, dueDate: isoDaysFromNow(2) })]),
    });
    expect(screen.getByRole("button", { name: "Ship release" })).toBeInTheDocument();
  });

  it("marks an overdue, not-done issue in the bar title", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([
        issue({
          id: "od",
          title: "Late task",
          status: "in_progress",
          startDate: isoDaysFromNow(-10),
          dueDate: isoDaysFromNow(-3),
        }),
      ]),
    });
    // The bar button carries a title that includes OVERDUE.
    const overdueBar = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("title") ?? "").includes("OVERDUE"));
    expect(overdueBar).toBeTruthy();
  });

  it("does not mark a done issue as overdue", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([
        issue({
          id: "done",
          title: "Finished task",
          status: "done",
          startDate: isoDaysFromNow(-10),
          dueDate: isoDaysFromNow(-3),
        }),
      ]),
    });
    const overdueBar = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("title") ?? "").includes("OVERDUE"));
    expect(overdueBar).toBeUndefined();
  });

  it("makes bars draggable to reschedule when the backend can store the dates", () => {
    const qc = seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) })]);
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: { startDate: { surface: true, store: true }, dueDate: { surface: true, store: true } },
    } as unknown as Capabilities);
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
    const bar = screen.getByTestId("gantt-bar-a");
    expect(bar).toHaveAccessibleName("Reschedule Design API");
    expect(bar.className).toMatch(/cursor-grab/);
  });

  it("keeps bars read-only (click-to-open) when the backend can't store the dates", () => {
    const qc = seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) })]);
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: { startDate: { surface: true, store: false }, dueDate: { surface: true, store: false } },
    } as unknown as Capabilities);
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
    const bar = screen.getByTestId("gantt-bar-a");
    expect(bar).toHaveAccessibleName("Design API"); // not "Reschedule …"
    expect(bar.className).not.toMatch(/cursor-grab/);
  });

  it("opens the issue dialog when a read-only bar is clicked (no reschedule capability)", async () => {
    const qc = seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) })]);
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: { startDate: { surface: true, store: false }, dueDate: { surface: true, store: false } },
    } as unknown as Capabilities);
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
    fireEvent.click(screen.getByTestId("gantt-bar-a"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opens the issue dialog when a lane label is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) })]),
    });
    await user.click(screen.getByRole("button", { name: "Design API" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  // jsdom doesn't implement pointer capture; stub so the drag handlers can run.
  beforeAll(() => {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  });

  function draggableClient(): QueryClient {
    const qc = seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5), version: 3 })]);
    qc.setQueryData(getGetCapabilitiesQueryKey(), {
      mode: "n8n",
      fields: { startDate: { surface: true, store: true }, dueDate: { surface: true, store: true } },
    } as unknown as Capabilities);
    return qc;
  }

  // jsdom's PointerEvent drops clientX from fireEvent init, so dispatch a pointer
  // event with clientX forced on (the handlers read e.clientX).
  function pointer(el: Element, type: string, clientX: number) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clientX", { value: clientX });
    Object.defineProperty(ev, "pointerId", { value: 1 });
    fireEvent(el, ev);
  }

  it("treats a moved pointer gesture as a drag, not a click (no dialog opens)", async () => {
    const qc = draggableClient();
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
    const bar = screen.getByTestId("gantt-bar-a");

    // down → move beyond the 3px slop → up: the `moved` ref makes this a drag,
    // so commitReschedule runs and the edit dialog is NOT opened.
    pointer(bar, "pointerdown", 100);
    pointer(bar, "pointermove", 140);
    pointer(bar, "pointerup", 140);

    await Promise.resolve();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a pointer down+up without movement is a click (opens the dialog), not a reschedule", async () => {
    const qc = draggableClient();
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
    const bar = screen.getByTestId("gantt-bar-a");
    const before = (qc.getQueryData<Issue[]>(getGetProjectIssuesQueryKey(PROJECT_ID)) ?? [])[0]!.startDate;

    fireEvent.pointerDown(bar, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(bar, { clientX: 101, pointerId: 1 }); // within the 3px slop

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // No reschedule happened.
    const after = (qc.getQueryData<Issue[]>(getGetProjectIssuesQueryKey(PROJECT_ID)) ?? [])[0]!.startDate;
    expect(after).toEqual(before);
  });

  it("draws the 'today' marker when today falls inside the timeline span", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([issue({ id: "a", title: "Spans today", startDate: isoDaysFromNow(-2), dueDate: isoDaysFromNow(3) })]),
    });
    expect(screen.getByTitle("Today")).toBeInTheDocument();
  });

  it("does not draw the 'today' marker when the whole timeline is in the future", () => {
    renderWithProviders(<GanttChart projectId={PROJECT_ID} />, {
      client: seeded([issue({ id: "a", title: "Future work", startDate: isoDaysFromNow(5), dueDate: isoDaysFromNow(9) })]),
    });
    expect(screen.queryByTitle("Today")).toBeNull();
  });

  describe("query states", () => {
    afterEach(() => resetFetchMock());

    it("shows the error state with a Retry when the issues query fails", async () => {
      mockFetchRouter({ [`/api/projects/${PROJECT_ID}/issues`]: { ok: false, status: 500, body: { error: "boom" } } });
      // No seeded cache → the query runs and fails (retry disabled by the default test client).
      renderWithProviders(<GanttChart projectId={PROJECT_ID} />);
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
    });

    it("shows the loading placeholder while the issues query is pending", () => {
      // A never-resolving fetch keeps the query in its loading state.
      globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
      renderWithProviders(<GanttChart projectId={PROJECT_ID} />);
      expect(screen.getByText("LOADING…")).toBeInTheDocument();
    });
  });

  describe("reschedule commit", () => {
    afterEach(() => resetFetchMock());

    it("shows a RESCHEDULED toast after a successful drag-commit", async () => {
      const qc = draggableClient();
      const moved = issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(41), dueDate: isoDaysFromNow(45), version: 4 });
      mockFetchRouter({
        [`/api/projects/${PROJECT_ID}/issues`]: { ok: true, body: [moved] },
        [`/api/projects/${PROJECT_ID}/issues/a`]: { ok: true, body: moved },
      });
      renderWithProviders(<><GanttChart projectId={PROJECT_ID} /><Toaster /></>, { client: qc });
      const bar = screen.getByTestId("gantt-bar-a");
      pointer(bar, "pointerdown", 100);
      pointer(bar, "pointermove", 140); // > 3px slop → a real drag
      pointer(bar, "pointerup", 140);
      expect(await screen.findByText("RESCHEDULED")).toBeInTheDocument();
    });

    it("reverts and shows an ERROR toast when the reschedule write fails", async () => {
      const qc = draggableClient();
      mockFetchRouter({
        [`/api/projects/${PROJECT_ID}/issues`]: { ok: true, body: [issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5), version: 3 })] },
        [`/api/projects/${PROJECT_ID}/issues/a`]: { ok: false, status: 500 },
      });
      renderWithProviders(<><GanttChart projectId={PROJECT_ID} /><Toaster /></>, { client: qc });
      const bar = screen.getByTestId("gantt-bar-a");
      pointer(bar, "pointerdown", 100);
      pointer(bar, "pointermove", 140);
      pointer(bar, "pointerup", 140);
      expect(await screen.findByText("ERROR")).toBeInTheDocument();
    });
  });

  describe("cascade mode (opt-in drag-a-bar-cascade)", () => {
    afterEach(() => { resetFetchMock(); saveEdges([]); });

    function edge(from: string, to: string): DependencyEdge {
      return {
        schema: 1, edgeKey: `${from}-blocks-${to}`,
        from: { system: "jira", projectRef: PROJECT_ID, itemRef: from },
        to: { system: "jira", projectRef: PROJECT_ID, itemRef: to },
        type: "blocks", fromHash: "x", toHash: "y", assertedAt: "2026-01-01T00:00:00Z",
      };
    }

    function cascadeClient(): QueryClient {
      const qc = seeded([
        issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5), version: 3 }),
        issue({ id: "b", title: "Build UI", startDate: isoDaysFromNow(6), dueDate: isoDaysFromNow(10), version: 2 }),
      ]);
      qc.setQueryData(getGetCapabilitiesQueryKey(), {
        mode: "n8n",
        fields: { startDate: { surface: true, store: true }, dueDate: { surface: true, store: true } },
      } as unknown as Capabilities);
      return qc;
    }

    it("shows the cascade toggle only when bars are reschedulable", () => {
      renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: cascadeClient() });
      expect(screen.getByTestId("gantt-cascade-toggle")).toBeInTheDocument();
    });

    it("hides the toggle when the backend can't store schedule dates", () => {
      const qc = seeded([issue({ id: "a", title: "Design API", startDate: isoDaysFromNow(1), dueDate: isoDaysFromNow(5) })]);
      qc.setQueryData(getGetCapabilitiesQueryKey(), {
        mode: "n8n",
        fields: { startDate: { surface: true, store: false }, dueDate: { surface: true, store: false } },
      } as unknown as Capabilities);
      renderWithProviders(<GanttChart projectId={PROJECT_ID} />, { client: qc });
      expect(screen.queryByTestId("gantt-cascade-toggle")).toBeNull();
    });

    it("cascades a dependent and writes both back when the toggle is on", async () => {
      saveEdges([edge("a", "b")]); // A blocks B
      const qc = cascadeClient();
      mockFetchRouter({
        [`/api/projects/${PROJECT_ID}/issues`]: { ok: true, body: [] },
        [`/api/projects/${PROJECT_ID}/issues/a`]: { ok: true, body: issue({ id: "a" }) },
        [`/api/projects/${PROJECT_ID}/issues/b`]: { ok: true, body: issue({ id: "b" }) },
      });
      renderWithProviders(<><GanttChart projectId={PROJECT_ID} /><Toaster /></>, { client: qc });
      fireEvent.click(screen.getByTestId("gantt-cascade-toggle"));
      const bar = screen.getByTestId("gantt-bar-a");
      pointer(bar, "pointerdown", 100);
      pointer(bar, "pointermove", 140); // +40px ≈ +40 days → pushes B (which followed A)
      pointer(bar, "pointerup", 140);
      // The cascade path fires and reports how many items moved.
      expect(await screen.findByText(/cascaded/)).toBeInTheDocument();
    });
  });
});
