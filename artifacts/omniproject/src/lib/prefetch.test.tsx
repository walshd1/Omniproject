import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderWithProviders } from "../test/utils";
import { useProjectPrefetch, usePredictivePrefetchSetting } from "./prefetch";
import { featuresQueryKey, type FeatureStatus } from "./features";

/**
 * Read-ahead prefetch: deterministic hover/focus is ALWAYS on; predictive is opt-in + module-gated.
 */

function seed(predictiveModule: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  qc.setQueryData(featuresQueryKey(), [
    { id: "predictivePrefetch", kind: "module", label: "Predictive loading", description: "", enabled: predictiveModule, loaded: true, needsRestart: false },
  ] satisfies FeatureStatus[]);
  return qc;
}

function Harness() {
  const { onIntentEnter, onIntentLeave, onIntentFocus, predictiveActive, runPredictive } = useProjectPrefetch();
  return (
    <div>
      <span data-testid="predictive">{predictiveActive ? "yes" : "no"}</span>
      <button onClick={() => onIntentFocus("p1")}>focus</button>
      <button onMouseEnter={() => onIntentEnter("p2")} onMouseLeave={onIntentLeave}>hover</button>
      <button onClick={() => runPredictive(["p3", "p4"])}>predict</button>
    </div>
  );
}

const calls = (id: string) =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => String(u).includes(`/api/projects/${id}/issues`));

beforeEach(() => {
  localStorage.clear();
  usePredictivePrefetchSetting.setState({ enabled: false });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("deterministic prefetch (always on)", () => {
  it("warms a project immediately on keyboard focus", async () => {
    renderWithProviders(<Harness />, { client: seed(false) }); // predictive off — deterministic still on
    fireEvent.click(screen.getByText("focus"));
    await waitFor(() => expect(calls("p1").length).toBeGreaterThan(0));
  });

  it("fires on hover only after the dwell, and a quick leave cancels it", async () => {
    vi.useFakeTimers();
    try {
      renderWithProviders(<Harness />, { client: seed(false) });
      const hover = screen.getByText("hover");
      fireEvent.mouseEnter(hover);
      fireEvent.mouseLeave(hover);          // left before the dwell elapsed
      act(() => { vi.advanceTimersByTime(200); });
      expect(calls("p2")).toHaveLength(0);  // cancelled

      fireEvent.mouseEnter(hover);
      act(() => { vi.advanceTimersByTime(200); }); // dwell elapses
      expect(calls("p2").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("predictive prefetch (opt-in + module-gated)", () => {
  it("is inert unless the module is enabled AND the user opted in", async () => {
    usePredictivePrefetchSetting.setState({ enabled: true });
    renderWithProviders(<Harness />, { client: seed(false) }); // module off
    expect(screen.getByTestId("predictive")).toHaveTextContent("no");
    fireEvent.click(screen.getByText("predict"));
    await Promise.resolve();
    expect(calls("p3")).toHaveLength(0);
  });

  it("warms the whole set when active", async () => {
    usePredictivePrefetchSetting.setState({ enabled: true });
    renderWithProviders(<Harness />, { client: seed(true) });
    expect(screen.getByTestId("predictive")).toHaveTextContent("yes");
    fireEvent.click(screen.getByText("predict"));
    await waitFor(() => expect(calls("p3").length).toBeGreaterThan(0));
    expect(calls("p4").length).toBeGreaterThan(0);
  });

  it("defaults off and persists a toggle", () => {
    expect(usePredictivePrefetchSetting.getState().enabled).toBe(false);
    act(() => usePredictivePrefetchSetting.getState().setEnabled(true));
    expect(localStorage.getItem("omni:predictive-prefetch")).toBe("1");
  });
});
