import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { DevModeWatermark } from "./DevModeWatermark";

/**
 * The DEV MODE watermark renders only when the backend reports a dev/debug
 * instance, and never otherwise — so a production build (which always reports
 * devMode:false) shows nothing.
 */
function clientWith(data: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["dev-mode"], data);
  return qc;
}

describe("DevModeWatermark", () => {
  it("shows the watermark + badge with active surfaces when dev mode is on", () => {
    const client = clientWith({ devMode: true, env: "development", surfaces: { persist: false, trace: true, capture: true } });
    renderWithProviders(<DevModeWatermark />, { client });
    expect(screen.getByTestId("dev-mode-watermark")).toBeInTheDocument();
    const badge = screen.getByTestId("dev-mode-badge");
    expect(badge).toHaveTextContent(/DEV MODE/i);
    expect(badge).toHaveTextContent(/development/);
    expect(badge).toHaveTextContent(/trace/);
    expect(badge).toHaveTextContent(/capture/);
  });

  it("renders nothing when dev mode is off (the production case)", () => {
    const client = clientWith({ devMode: false, env: "production", surfaces: { persist: false, trace: false, capture: false } });
    renderWithProviders(<DevModeWatermark />, { client });
    expect(screen.queryByTestId("dev-mode-watermark")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dev-mode-badge")).not.toBeInTheDocument();
  });

  it("renders nothing before the status has loaded", () => {
    const client = clientWith(undefined);
    renderWithProviders(<DevModeWatermark />, { client });
    expect(screen.queryByTestId("dev-mode-watermark")).not.toBeInTheDocument();
  });
});
