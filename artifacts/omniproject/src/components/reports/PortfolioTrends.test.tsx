import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import {
  getListProjectsQueryKey,
  getGetPortfolioHealthQueryKey,
  getGetCapabilitiesQueryKey,
  type Project,
  type PortfolioHealthSummary,
} from "@workspace/api-client-react";
import { renderWithProviders, mockBlobDownload } from "../../test/utils";
import { Toaster } from "../ui/toaster";
import { PortfolioTrends } from "./PortfolioTrends";

/** datetime-local input value matching a Date's LOCAL components (avoids UTC/local drift). */
function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const projects = [
  { id: "p1", name: "Alpha", identifier: "AL", source: "jira", issueCount: 10, completedCount: 5, memberCount: 1, updatedAt: "" },
] as unknown as Project[];
const portfolio = [
  { projectId: "p1", projectName: "Alpha", ragStatus: "RED", scheduleVarianceDays: -4, budgetVariancePercentage: 8, activeBlockersCount: 2 },
] as unknown as PortfolioHealthSummary[];

/** `opts.mode` additionally seeds getCapabilities, e.g. `seeded({ mode: "demo" })` to test
 *  the sample-data badge; omit it for the plain "live" case used by most tests. */
function seeded(opts: { mode?: string } = {}): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getListProjectsQueryKey(), projects);
  qc.setQueryData(getGetPortfolioHealthQueryKey(), portfolio);
  if (opts.mode) qc.setQueryData(getGetCapabilitiesQueryKey(), { mode: opts.mode });
  return qc;
}

/** Renders PortfolioTrends, fills the auto-capture interval/end fields, and clicks the
 *  toggle to start the schedule. Caller must have fake timers active with `now` already
 *  set as the system time (via `vi.useFakeTimers()` + `vi.setSystemTime(now)`). */
function startAutoSchedule(client: QueryClient, now: Date, opts: { intervalMinutes: number; endsInMinutes: number }) {
  const rendered = renderWithProviders(<PortfolioTrends />, { client });
  fireEvent.change(screen.getByLabelText("Auto-capture interval in minutes"), { target: { value: String(opts.intervalMinutes) } });
  const endsAt = new Date(now.getTime() + opts.endsInMinutes * 60_000);
  fireEvent.change(screen.getByLabelText("Auto-capture end date and time"), { target: { value: localInputValue(endsAt) } });
  fireEvent.click(screen.getByTestId("auto-toggle"));
  return rendered;
}

beforeEach(() => window.sessionStorage.clear());

describe("PortfolioTrends", () => {
  it("shows the empty prompt until at least two snapshots exist", () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    expect(screen.getByTestId("trend-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).not.toBeInTheDocument();
  });

  it("captures snapshots into the session and renders a trend at two points", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    const capture = screen.getByTestId("capture-snapshot");
    await userEvent.click(capture);
    await userEvent.click(capture);
    // Two captured points → the chart renders, empty prompt gone.
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-empty")).not.toBeInTheDocument();
    // The captured points are listed.
    expect(screen.getByLabelText("Captured snapshots")).toBeInTheDocument();
  });

  it("flags captured data with the provenance badge (not backend fact)", () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    expect(screen.getByText(/captured/i)).toBeInTheDocument();
  });

  it("captures with a custom label, applies it to the entry, and clears the field", async () => {
    renderWithProviders(<><PortfolioTrends /><Toaster /></>, { client: seeded() });
    const labelInput = screen.getByLabelText("Snapshot label");
    await userEvent.type(labelInput, "Sprint 12 close");
    await userEvent.click(screen.getByTestId("capture-snapshot"));

    expect(await screen.findByText("SNAPSHOT CAPTURED")).toBeInTheDocument();
    expect(screen.getByText("Sprint 12 close")).toBeInTheDocument();
    expect(labelInput).toHaveValue("");
  });

  it("changes the selected trend metric", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    await userEvent.click(screen.getByTestId("trend-metric-select"));
    await userEvent.click(await screen.findByRole("option", { name: /budget variance/i }));
    expect(screen.getByTestId("trend-metric-select")).toHaveTextContent(/budget variance/i);
  });

  it("clicking Import triggers the hidden file input", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      await userEvent.click(screen.getByRole("button", { name: /^import$/i }));
      expect(clickSpy).toHaveBeenCalled();
    } finally {
      clickSpy.mockRestore();
    }
  });

  it("imports snapshots from a file and toasts", async () => {
    renderWithProviders(<><PortfolioTrends /><Toaster /></>, { client: seeded() });
    const bundle = {
      schema: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      snapshots: [
        { capturedAt: "2026-01-01T00:00:00.000Z", projects: [{ id: "p1", name: "Alpha", issueCount: 10, completedCount: 5 }], portfolio: [] },
      ],
    };
    const file = new File([JSON.stringify(bundle)], "trends.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(await screen.findByText("SNAPSHOTS IMPORTED")).toBeInTheDocument();
    expect(screen.getByLabelText("Captured snapshots")).toBeInTheDocument();
  });

  it("shows an error toast when the imported file has no valid snapshots", async () => {
    renderWithProviders(<><PortfolioTrends /><Toaster /></>, { client: seeded() });
    const file = new File(["not json"], "trends.json", { type: "application/json" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(await screen.findByText("IMPORT FAILED")).toBeInTheDocument();
    expect(screen.queryByLabelText("Captured snapshots")).toBeNull();
  });

  it("exports all snapshots and a single snapshot as file downloads", async () => {
    const { click, restore } = mockBlobDownload();
    try {
      renderWithProviders(<PortfolioTrends />, { client: seeded() });
      const capture = screen.getByTestId("capture-snapshot");
      await userEvent.click(capture);

      expect(screen.getByRole("button", { name: /export all/i })).toBeEnabled();
      await userEvent.click(screen.getByRole("button", { name: /export all/i }));
      expect(click).toHaveBeenCalledTimes(1);

      await userEvent.click(screen.getByRole("button", { name: /export snapshot/i }));
      expect(click).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it("disables Export all until a snapshot exists", () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    expect(screen.getByRole("button", { name: /export all/i })).toBeDisabled();
  });

  it("marks a snapshot captured in demo mode as sample data", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded({ mode: "demo" }) });
    await userEvent.click(screen.getByTestId("capture-snapshot"));
    expect(screen.getByText(/· sample/)).toBeInTheDocument();
  });

  it("selecting then clearing the file input does nothing (no file to import)", async () => {
    renderWithProviders(<><PortfolioTrends /><Toaster /></>, { client: seeded() });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(screen.queryByText("IMPORT FAILED")).toBeNull();
    expect(screen.queryByText("SNAPSHOTS IMPORTED")).toBeNull();
  });

  it("deletes a snapshot from the list", async () => {
    renderWithProviders(<PortfolioTrends />, { client: seeded() });
    await userEvent.click(screen.getByTestId("capture-snapshot"));
    expect(screen.getByLabelText("Captured snapshots")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /delete snapshot/i }));
    expect(screen.queryByLabelText("Captured snapshots")).toBeNull();
  });

  it("rejects starting an auto-capture schedule with no end time set", async () => {
    renderWithProviders(<><PortfolioTrends /><Toaster /></>, { client: seeded() });
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("INVALID SCHEDULE")).toBeInTheDocument();
    expect(screen.getByTestId("auto-toggle")).toHaveTextContent("Start"); // still stopped
  });

  it("runs an auto-capture schedule: captures on start and again after an interval, then auto-stops at its end", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date(2026, 0, 1, 10, 0, 0);
      vi.setSystemTime(now);
      startAutoSchedule(seeded(), now, { intervalMinutes: 5, endsInMinutes: 20 });

      // Captured immediately on start (the ticker fires once synchronously on mount).
      expect(screen.getByTestId("auto-status")).toHaveTextContent("Every 5 min");
      expect(screen.getByLabelText("Captured snapshots")).toBeInTheDocument();
      const afterStart = screen.getAllByRole("listitem").length;

      // A full interval elapses (the ticker itself runs every min(interval, 30s), so this
      // advance spans several ticks before one lands on/after the 5-minute mark).
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(screen.getAllByRole("listitem").length).toBe(afterStart + 1);

      // Past the schedule's end: the ticker stops itself and the UI reverts to "Start".
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      expect(screen.getByTestId("auto-toggle")).toHaveTextContent("Start");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a running auto-capture schedule on demand", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date(2026, 0, 1, 10, 0, 0);
      vi.setSystemTime(now);
      startAutoSchedule(seeded(), now, { intervalMinutes: 5, endsInMinutes: 20 });
      expect(screen.getByTestId("auto-toggle")).toHaveTextContent("Stop");

      fireEvent.click(screen.getByTestId("auto-toggle"));
      expect(screen.getByTestId("auto-toggle")).toHaveTextContent("Start");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the ticker interval when unmounted while a schedule is running", async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    try {
      const now = new Date(2026, 0, 1, 10, 0, 0);
      vi.setSystemTime(now);
      const { unmount } = startAutoSchedule(seeded(), now, { intervalMinutes: 5, endsInMinutes: 20 });
      expect(screen.getByTestId("auto-toggle")).toHaveTextContent("Stop");

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalled();
    } finally {
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
