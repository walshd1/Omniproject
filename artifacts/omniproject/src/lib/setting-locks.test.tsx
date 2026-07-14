import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettingLocks, type FieldLock } from "./setting-locks";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("useSettingLocks", () => {
  it("reads the server locks and resolves lockFor(path)", async () => {
    const locks: FieldLock[] = [
      { path: "fxRatePolicy", state: "disabled", reason: "No reporting currency is set, so FX conversion is off." },
      { path: "aiModel", state: "forced", forcedValue: null, reason: "No AI provider is selected, so a model can't be chosen." },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ locks }), { status: 200 })));

    const { result } = renderHook(() => useSettingLocks(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.locks.length).toBe(2));

    expect(result.current.lockFor("fxRatePolicy")?.state).toBe("disabled");
    const model = result.current.lockFor("aiModel");
    expect(model?.state).toBe("forced");
    expect(model?.forcedValue).toBeNull();
    expect(result.current.lockFor("nope")).toBeUndefined();
  });

  it("degrades to no locks when the endpoint is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { result } = renderHook(() => useSettingLocks(), { wrapper: wrapper() });
    // No throw; empty locks so panels stay usable if the constraints read fails.
    expect(result.current.lockFor("fxRatePolicy")).toBeUndefined();
    expect(result.current.locks).toEqual([]);
  });
});
