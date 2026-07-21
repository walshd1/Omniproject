import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { timerKey, formatElapsed, type TimerState } from "../lib/live-timer";
import { featuresQueryKey } from "../lib/features";
import { TimerWidget } from "./TimerWidget";

/** The live timer widget: idle start-form vs running display. The widget gates its `/api/timer` fetch (and
 *  its own render) on the `timeTracking` module having LOADED and being enabled (fail-closed while the
 *  feature list is undefined, so it never races a 404), so seed the feature list with it on. */
function seed(state: TimerState): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(timerKey, state);
  qc.setQueryData(featuresQueryKey(), [{ id: "timeTracking", kind: "module", label: "Time tracking", description: "", enabled: true, loaded: true, needsRestart: false }]);
  return qc;
}

describe("formatElapsed", () => {
  it("renders hours as H:MM", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1.5)).toBe("1:30");
    expect(formatElapsed(0.25)).toBe("0:15");
    expect(formatElapsed(-5)).toBe("0:00");
  });
});

describe("TimerWidget", () => {
  it("shows a start form when idle", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: false }) });
    expect(screen.getByTestId("timer-start")).toBeInTheDocument();
    expect(screen.queryByTestId("timer-stop")).toBeNull();
  });

  it("shows the elapsed time + a stop button when running", () => {
    renderWithProviders(<TimerWidget />, { client: seed({ running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1" }, elapsedHours: 0 }) });
    expect(screen.getByTestId("timer-elapsed")).toBeInTheDocument();
    expect(screen.getByTestId("timer-stop")).toBeInTheDocument();
    expect(screen.getByText("P1")).toBeInTheDocument();
  });
});
