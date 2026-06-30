import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, getReplayHistoryQueryKey, type Capabilities, type HistoryState } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { TimeTravel } from "./TimeTravel";

function caps(timeTravel: boolean): Capabilities {
  return {
    mode: "demo", issues: true, scheduling: true, resources: true, financials: true,
    portfolio: true, baseline: true, blockers: true, history: true, raid: true,
    quality: true, crm: true, service: true, benefits: true, timeTravel,
  };
}

function seeded(timeTravel: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), caps(timeTravel));
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("TimeTravel", () => {
  it("is LOCKED and points to Settings when the logging sync is off", () => {
    renderWithProviders(<TimeTravel />, { client: seeded(false) });
    expect(screen.getByTestId("time-travel-locked")).toBeInTheDocument();
    expect(screen.getByText(/logging server/i)).toBeInTheDocument();
    expect(screen.queryByTestId("time-travel")).not.toBeInTheDocument();
  });

  it("unlocks when capabilities.timeTravel is true", () => {
    renderWithProviders(<TimeTravel />, { client: seeded(true) });
    expect(screen.getByTestId("time-travel")).toBeInTheDocument();
    expect(screen.queryByTestId("time-travel-locked")).not.toBeInTheDocument();
    // No captures yet → empty prompt, no scrubber.
    expect(screen.getByTestId("time-travel-empty")).toBeInTheDocument();
  });

  it("renders replayed server points with a scrubber and updates on scrub", () => {
    const qc = seeded(true);
    const points: HistoryState[] = [
      { at: "2026-01-01T00:00:00Z", completionPct: 20, openBlockers: 3, provenance: "sourced" },
      { at: "2026-02-01T00:00:00Z", completionPct: 55, openBlockers: 1, provenance: "sourced" },
      { at: "2026-03-01T00:00:00Z", completionPct: 80, openBlockers: 0, provenance: "sourced" },
    ] as unknown as HistoryState[];
    qc.setQueryData(getReplayHistoryQueryKey(undefined), points);

    renderWithProviders(<TimeTravel />, { client: qc });
    const scrubber = screen.getByTestId("time-travel-scrubber") as HTMLInputElement;
    expect(scrubber.max).toBe("2"); // 3 points → indices 0..2
    expect(screen.getByText(/20% complete/)).toBeInTheDocument(); // first point selected

    // Scrub to the last point — the completion read-out follows.
    fireEvent.change(scrubber, { target: { value: "2" } });
    expect(screen.getByText(/80% complete/)).toBeInTheDocument();
    expect(screen.queryByTestId("time-travel-empty")).toBeNull();
  });
});
