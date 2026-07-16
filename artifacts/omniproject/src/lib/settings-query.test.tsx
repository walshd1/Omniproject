import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSettingsSlice } from "./settings-query";

/**
 * The whole point of settings-query: many hooks slice ONE shared `/api/settings` read, so several slices
 * cause a SINGLE network request (dedup), not one per hook.
 */
afterEach(() => vi.restoreAllMocks());

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useSettingsSlice", () => {
  it("dedupes multiple slices into one /api/settings fetch and selects correctly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ screenDefs: [{ id: "x" }], disabledScreens: ["home"], reportingCurrency: "USD" }), { status: 200 }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = wrapper(qc);

    const a = renderHook(() => useSettingsSlice((s) => s["screenDefs"]), { wrapper: w });
    const b = renderHook(() => useSettingsSlice((s) => s["disabledScreens"]), { wrapper: w });
    const c = renderHook(() => useSettingsSlice((s) => s["reportingCurrency"]), { wrapper: w });

    await waitFor(() => {
      expect(a.result.current.data).toEqual([{ id: "x" }]);
      expect(b.result.current.data).toEqual(["home"]);
      expect(c.result.current.data).toBe("USD");
    });
    // Three slices, ONE request to /api/settings.
    const settingsCalls = fetchMock.mock.calls.filter(([u]) => String(u) === "/api/settings");
    expect(settingsCalls).toHaveLength(1);
  });
});
