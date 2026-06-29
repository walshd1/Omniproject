import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSavedViews, useSaveViews, savedViewsQueryKey, type SavedView } from "./saved-views";

const VIEWS: SavedView[] = [
  { id: "v1", name: "My grid", scope: "grid", columns: ["title", "status"], sort: { field: "status", dir: "asc" } },
];

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSavedViews", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ views: VIEWS }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("unwraps the views array from the envelope", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSavedViews(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.[0]?.name).toBe("My grid");
  });
});

describe("useSaveViews", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ views: VIEWS }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("PUTs the full list and invalidates the cache on success", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveViews(), { wrapper: wrapper(client) });
    result.current.mutate(VIEWS);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/views");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(String((opts as RequestInit).body)).toContain("My grid");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: savedViewsQueryKey });
  });

  it("throws when the server rejects the save", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useSaveViews(), { wrapper: wrapper(client) });
    result.current.mutate(VIEWS);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
