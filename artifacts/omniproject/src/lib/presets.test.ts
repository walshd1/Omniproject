import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePresets, useApplyPreset, presetsKey, type Preset } from "./presets";

/**
 * Quick-load PRESET client hooks over `/api/presets`. Listing is a plain GET; applying POSTs to the
 * encoded-id apply endpoint with an optional starter-project name in the body, and the RESPONSE carries the
 * SPA-owned follow-ups. Mirrors the defs.test.ts harness (retry-disabled client + stubbed fetch).
 */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

const preset = (id: string): Preset => ({ id, label: id, description: "", methodology: "agile", order: 1 });

describe("presetsKey", () => {
  it("is the stable cache key", () => {
    expect(presetsKey).toEqual(["presets"]);
  });
});

describe("usePresets", () => {
  it("GETs the shipped preset list", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([preset("kanban"), preset("waterfall")]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => usePresets(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/presets");
    expect(result.current.data!.map((p) => p.id)).toEqual(["kanban", "waterfall"]);
  });

  it("propagates a server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));
    const { result } = renderHook(() => usePresets(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("boom");
  });
});

describe("useApplyPreset", () => {
  it("POSTs to the encoded apply endpoint with the project name in the body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ presetId: "agile scrum", methodology: "agile", applied: {}, followUps: { methodologyComposition: "c" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useApplyPreset(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "agile scrum", name: "My Project" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/presets/agile%20scrum/apply");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ name: "My Project" });
    expect(result.current.data!.followUps.methodologyComposition).toBe("c");
  });

  it("sends an empty body when no name is supplied", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ presetId: "k", methodology: "agile", applied: {}, followUps: { methodologyComposition: "c" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useApplyPreset(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "k" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/presets/k/apply");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({});
  });

  it("surfaces the server error when the apply fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "not allowed" }, 403)));
    const { result } = renderHook(() => useApplyPreset(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "k" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("not allowed");
  });
});
