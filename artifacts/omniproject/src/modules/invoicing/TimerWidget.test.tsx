import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders, mockFetchRouter, resetFetchMock } from "../../test/utils";
import { timerKey, formatElapsed, type TimerState } from "./live-timer";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";
import { TimerWidget } from "./TimerWidget";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock, dismiss: vi.fn(), toasts: [] }) }));

/** The live timer widget: idle start-form vs running display, start/stop mutations, the local 1s tick, and the
 *  timeTracking feature gate. `useFeatureEnabled("timeTracking")` reads false when the features query is unseeded,
 *  so seed the feature ENABLED by default — a test that exercises the gate passes its own `features` override. */
function seed(state: TimerState, features?: FeatureStatus[]): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(timerKey, state);
  qc.setQueryData(featuresQueryKey({}), features ?? [feature()]);
  return qc;
}

const feature = (over: Partial<FeatureStatus> = {}): FeatureStatus => ({
  id: "timeTracking", kind: "module", label: "Time tracking", description: "", enabled: true, loaded: true, needsRestart: false, ...over,
});

afterEach(() => {
  resetFetchMock();
  toastMock.mockReset();
});

describe("formatElapsed", () => {
  it("renders hours as H:MM, clamping negatives", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1.5)).toBe("1:30");
    expect(formatElapsed(0.25)).toBe("0:15");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("TimerWidget — gating", () => {
  it("renders nothing when the timeTracking feature is disabled", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }, [feature({ enabled: false })]) });
    expect(screen.queryByTestId("timer-widget")).toBeNull();
  });

  it("renders nothing when the timeTracking feature is forbidden by policy", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }, [feature({ policy: "forbid" })]) });
    expect(screen.queryByTestId("timer-widget")).toBeNull();
  });

  it("renders when the feature is enabled", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }, [feature()]) });
    expect(screen.getByTestId("timer-widget")).toBeInTheDocument();
  });
});

describe("TimerWidget — idle", () => {
  it("shows a start form when idle", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }) });
    expect(screen.getByTestId("timer-start")).toBeInTheDocument();
    expect(screen.queryByTestId("timer-stop")).toBeNull();
  });

  it("keeps start disabled until a project is entered", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }) });
    expect(screen.getByTestId("timer-start")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "P1" } });
    expect(screen.getByTestId("timer-start")).not.toBeDisabled();
  });

  it("prefills the project from defaultProjectId", () => {
    renderWithProviders(<TimerWidget defaultProjectId="PX" />, { client: seed({ running: false }) });
    expect(screen.getByLabelText("Project")).toHaveValue("PX");
    expect(screen.getByTestId("timer-start")).not.toBeDisabled();
  });

  it("starts the timer with the project and note", async () => {
    const running: TimerState = { running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1", note: "hi" }, elapsedHours: 0 };
    const calls = mockFetchRouter({ "POST /api/timer/start": { ok: true, body: running } });
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }) });
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: " P1 " } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: " hi " } });
    fireEvent.click(screen.getByTestId("timer-start"));

    await waitFor(() => expect(calls.some((c) => new URL(c.url, "http://x").pathname === "/api/timer/start")).toBe(true));
    const body = String(calls.find((c) => c.init?.method === "POST")!.init?.body);
    expect(body).toContain("\"projectId\":\"P1\"");
    expect(body).toContain("\"note\":\"hi\"");
  });

  it("starts without a note when the note field is blank", async () => {
    const calls = mockFetchRouter({ "POST /api/timer/start": { ok: true, body: { running: true, timer: { startedAt: new Date().toISOString(), projectId: "P2" } } } });
    renderWithProviders(<TimerWidget defaultProjectId="P2" />, { client: seed({ running: false }) });
    fireEvent.click(screen.getByTestId("timer-start"));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "POST")).toBe(true));
    expect(String(calls.find((c) => c.init?.method === "POST")!.init?.body)).not.toContain("note");
  });
});

describe("TimerWidget — running", () => {
  it("shows the elapsed time, project, and a stop button", () => {
    renderWithProviders(<TimerWidget />, {
      client: seed({ running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1" }, elapsedHours: 0 }),
    });
    expect(screen.getByTestId("timer-elapsed")).toBeInTheDocument();
    expect(screen.getByTestId("timer-stop")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
  });

  it("derives live elapsed from the started timestamp", () => {
    const startedAt = new Date(Date.now() - 90 * 60_000).toISOString(); // 1h30m ago
    renderWithProviders(<TimerWidget />, {
      client: seed({ running: true, timer: { startedAt, projectId: "P1" } }),
    });
    expect(screen.getByTestId("timer-elapsed")).toHaveTextContent("1:30");
  });

  it("stops the timer and toasts the logged entry", async () => {
    const calls = mockFetchRouter({
      "POST /api/timer/stop": { ok: true, body: { running: false, entry: { projectId: "P1", date: "2026-07-20", hours: 2 } } },
    });
    renderWithProviders(<TimerWidget />, {
      client: seed({ running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1" }, elapsedHours: 2 }),
    });
    fireEvent.click(screen.getByTestId("timer-stop"));

    await waitFor(() => expect(calls.some((c) => new URL(c.url, "http://x").pathname === "/api/timer/stop")).toBe(true));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "TIMER STOPPED", description: "Logged 2h on P1" })));
  });
});

describe("TimerWidget — local tick", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }));
  afterEach(() => vi.useRealTimers());

  it("advances the tick attribute once a second while running", () => {
    renderWithProviders(<TimerWidget />, {
      client: seed({ running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1" }, elapsedHours: 0 }),
    });
    const el = screen.getByTestId("timer-elapsed");
    expect(el).toHaveAttribute("data-tick", "0");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(el).toHaveAttribute("data-tick", "2");
  });

  it("does not tick while idle", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }) });
    act(() => { vi.advanceTimersByTime(3000); });
    // No elapsed display exists when idle → nothing ticks.
    expect(screen.queryByTestId("timer-elapsed")).toBeNull();
  });
});
