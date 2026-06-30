import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { featureEnabled, useFeatures, useSetDisabledFeatures, type FeatureStatus } from "./features";

const FEATURES: FeatureStatus[] = [
  { id: "grid", kind: "module", label: "Grid", description: "", enabled: true, loaded: true, needsRestart: false },
  { id: "odata", kind: "module", label: "OData", description: "", enabled: false, loaded: false, needsRestart: false },
];

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("featureEnabled", () => {
  it("reflects the enabled flag for a known feature", () => {
    expect(featureEnabled(FEATURES, "grid")).toBe(true);
    expect(featureEnabled(FEATURES, "odata")).toBe(false);
  });
  it("defaults to true for unknown ids or while loading", () => {
    expect(featureEnabled(FEATURES, "mystery")).toBe(true);
    expect(featureEnabled(undefined, "grid")).toBe(true);
  });
});

describe("useFeatures", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: FEATURES }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("unwraps the features array from the envelope", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFeatures(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.map((f) => f.id)).toEqual(["grid", "odata"]);
  });
});

describe("useSetDisabledFeatures", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("PATCHes /api/settings with the opt-out set and invalidates features", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetDisabledFeatures(), { wrapper: wrapper(client) });
    result.current.mutate(["odata"]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/settings");
    expect((opts as RequestInit).method).toBe("PATCH");
    expect(String((opts as RequestInit).body)).toContain("disabledFeatures");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["features"] });
  });

  it("throws when the server rejects the patch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "no" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useSetDisabledFeatures(), { wrapper: wrapper(client) });
    result.current.mutate(["x"]);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
