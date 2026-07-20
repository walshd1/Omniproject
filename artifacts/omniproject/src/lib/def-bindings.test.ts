import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bindingsKey, useDefBindings, useSetBinding, type BindingMaps } from "./def-bindings";

/**
 * def-bindings.ts is the def SELECTION-BINDINGS client over `/api/defs/bindings`: read the per-scope
 * slot→binding maps (with the scope-context query string) and set/clear one slot. Each hook is driven through
 * a retry-disabled QueryClient with a stubbed `fetch`, asserting the method/URL/query string it hits and the
 * query keys its `onSuccess` invalidates.
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
const maps: BindingMaps = { org: {}, programme: {}, project: {}, user: {} };

afterEach(() => vi.restoreAllMocks());

describe("bindingsKey", () => {
  it("is the shared cache key prefix", () => {
    expect(bindingsKey).toEqual(["defs", "bindings"]);
  });
});

describe("useDefBindings", () => {
  it("GETs the bare bindings endpoint (no scope context)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(maps));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefBindings(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/bindings");
    expect(result.current.data).toEqual(maps);
  });

  it("appends only the projectId when just a project is in context", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(maps));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefBindings("p1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/bindings?projectId=p1");
  });

  it("appends only the programmeId when just a programme is in context", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(maps));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefBindings(undefined, "pr1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/bindings?programmeId=pr1");
  });

  it("appends both ids when a project belongs to a programme", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(maps));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefBindings("p1", "pr1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/bindings?projectId=p1&programmeId=pr1");
  });
});

describe("useSetBinding", () => {
  it("PUTs the selection and invalidates the bindings + active-winner caches", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ scope: "org", bindings: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetBinding(), { wrapper: wrapper(client) });
    result.current.mutate({ scope: "org", slot: "screens", defId: "org~a", locked: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs/bindings");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toMatchObject({ scope: "org", slot: "screens", defId: "org~a", locked: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: bindingsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["defs", "active"] });
  });

  it("clears a slot (defId null) and surfaces a server refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "step-up needed" }, 403)));
    const { result } = renderHook(() => useSetBinding(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ scope: "user", slot: "screens", defId: null });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("step-up needed");
  });
});
