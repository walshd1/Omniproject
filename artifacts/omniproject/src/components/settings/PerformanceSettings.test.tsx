import { describe, it, expect, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../../test/utils";
import { PerformanceSettings } from "./PerformanceSettings";
import { usePredictivePrefetchSetting } from "../../lib/prefetch";
import { useOfflineCacheSetting } from "../../lib/use-offline-cache";
import { featuresQueryKey, type FeatureStatus } from "../../lib/features";

function seed(moduleEnabled: boolean, offlineEnabled = false): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(featuresQueryKey(), [
    { id: "predictivePrefetch", kind: "module", label: "Predictive loading", description: "", enabled: moduleEnabled, loaded: true, needsRestart: false },
    { id: "offlineCache", kind: "module", label: "Offline cache", description: "", enabled: offlineEnabled, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  return qc;
}

beforeEach(() => {
  localStorage.clear();
  usePredictivePrefetchSetting.setState({ enabled: false });
  useOfflineCacheSetting.setState({ enabled: false });
});

describe("PerformanceSettings", () => {
  it("renders nothing when both performance feature modules are disabled org-wide", () => {
    const { container } = renderWithProviders(<PerformanceSettings />, { client: seed(false, false) });
    expect(container.firstChild).toBeNull();
  });

  it("shows the offline-cache toggle (off, encrypted-ephemeral note) when the module is enabled", () => {
    renderWithProviders(<PerformanceSettings />, { client: seed(false, true) });
    const toggle = screen.getByTestId("offline-cache-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("offline-cache-settings")).toHaveTextContent(/encrypted/i);
    fireEvent.click(toggle);
    expect(useOfflineCacheSetting.getState().enabled).toBe(true);
    expect(localStorage.getItem("omni.offlineCache")).toBe("1");
  });

  it("shows the predictive toggle (off) with a prominent health warning when enabled", () => {
    renderWithProviders(<PerformanceSettings />, { client: seed(true) });
    const toggle = screen.getByRole("switch", { name: /predictive loading/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    const warning = screen.getByTestId("predictive-prefetch-warning");
    expect(warning).toHaveTextContent(/real call to your backend/i);
    expect(warning).toHaveTextContent(/rate limits/i);
    // The always-on deterministic tier is described, not toggled.
    expect(screen.getByText(/prefetch-on-hover is always on/i)).toBeInTheDocument();
  });

  it("turns the per-user predictive setting on and persists it", () => {
    renderWithProviders(<PerformanceSettings />, { client: seed(true) });
    fireEvent.click(screen.getByRole("switch", { name: /predictive loading/i }));
    expect(usePredictivePrefetchSetting.getState().enabled).toBe(true);
    expect(localStorage.getItem("omni:predictive-prefetch")).toBe("1");
  });
});
