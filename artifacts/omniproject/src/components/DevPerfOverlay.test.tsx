import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { DevPerfOverlay } from "./DevPerfOverlay";

/**
 * The perf overlay is dev-mode-gated exactly like the watermark: present on a
 * dev/debug instance, absent in production (which always reports devMode:false).
 */
function clientWith(data: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["dev-mode"], data);
  return qc;
}

describe("DevPerfOverlay", () => {
  it("shows the timing HUD when dev mode is on", () => {
    renderWithProviders(<DevPerfOverlay />, { client: clientWith({ devMode: true }) });
    expect(screen.getByTestId("dev-perf-overlay")).toBeInTheDocument();
    expect(screen.getByText(/PERF/)).toBeInTheDocument();
  });

  it("renders nothing in production (devMode:false)", () => {
    renderWithProviders(<DevPerfOverlay />, { client: clientWith({ devMode: false }) });
    expect(screen.queryByTestId("dev-perf-overlay")).not.toBeInTheDocument();
  });
});
