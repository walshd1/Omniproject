import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { useLocation } from "wouter";
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

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

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

  it("collapses and re-expands the HUD body via the header toggle", () => {
    renderWithProviders(<DevPerfOverlay />, { client: clientWith({ devMode: true }) });
    const toggle = screen.getByRole("button", { name: /PERF/ });
    // Starts open: the API-calls row is visible and the caret points down.
    expect(screen.getByText("API calls")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("API calls")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("API calls")).toBeInTheDocument();
  });

  it("renders navigation-timing rows once the deferred read resolves", async () => {
    vi.stubGlobal("performance", {
      now: () => 0,
      getEntriesByType: (type: string) =>
        type === "navigation"
          ? [{ responseStart: 120, domContentLoadedEventEnd: 340, loadEventEnd: 700, duration: 700 }]
          : [],
    });
    renderWithProviders(<DevPerfOverlay />, { client: clientWith({ devMode: true }) });
    // The nav read is deferred via setTimeout(0); wait for the TTFB row to appear.
    expect(await screen.findByText("TTFB")).toBeInTheDocument();
    expect(screen.getByText("120ms")).toBeInTheDocument();
    expect(screen.getByText("340ms")).toBeInTheDocument();
    expect(screen.getByText("700ms")).toBeInTheDocument();
  });

  it("collects API latency samples from the PerformanceObserver and summarises them", async () => {
    const entry = {
      name: "http://localhost/api/projects/p1/issues",
      duration: 480,
      serverTiming: [
        { name: "upstream", duration: 300 },
        { name: "gateway", duration: 40 },
        { name: "total", duration: 340 },
      ],
    };
    class FakePO {
      constructor(private cb: (list: { getEntries: () => unknown[] }) => void) {}
      observe() {
        this.cb({ getEntries: () => [entry] });
      }
      disconnect() {}
    }
    vi.stubGlobal("PerformanceObserver", FakePO as unknown as typeof PerformanceObserver);
    renderWithProviders(<DevPerfOverlay />, { client: clientWith({ devMode: true }) });
    expect(await screen.findByText("API p50 / p95")).toBeInTheDocument();
    expect(screen.getByText("avg gateway / upstream")).toBeInTheDocument();
    // One sample collected → the count row reads 1.
    expect(screen.getByText("API calls").parentElement).toHaveTextContent("1");
  });

  it("times a route switch and shows the Route switch row", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    function Nav() {
      const [, navigate] = useLocation();
      return <button onClick={() => navigate("/elsewhere")}>go</button>;
    }
    renderWithProviders(
      <>
        <DevPerfOverlay />
        <Nav />
      </>,
      { client: clientWith({ devMode: true }) },
    );
    // First render is skipped (initial load); a subsequent route change is timed.
    expect(screen.queryByText("Route switch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => expect(screen.getByText("Route switch")).toBeInTheDocument());
  });
});
