import { describe, it, expect, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { getGetCapabilitiesQueryKey, type Capabilities } from "@workspace/api-client-react";
import { renderWithProviders } from "../../test/utils";
import { TimeTravel } from "./TimeTravel";

function caps(timeTravel: boolean): Capabilities {
  return {
    mode: "demo", issues: true, scheduling: true, resources: true, financials: true,
    portfolio: true, baseline: true, blockers: true, history: true, raid: true, timeTravel,
  };
}

function seeded(timeTravel: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(getGetCapabilitiesQueryKey(), caps(timeTravel));
  return qc;
}

beforeEach(() => window.sessionStorage.clear());

describe("TimeTravel", () => {
  it("is LOCKED and points to Settings when the logging sink is off", () => {
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
});
