import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { trendQueryKey, useTrend, type TrendQuery, type TrendSeries } from "./trends";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("trendQueryKey", () => {
  it("fills defaults for every optional field", () => {
    expect(trendQueryKey({ metric: "cpi" })).toEqual(["trend", "cpi", "month", null, null, null, "", null, null]);
  });

  it("includes every field the URL varies on so distinct queries never collide", () => {
    const q: TrendQuery = { metric: "spi", grain: "week", programmeId: "pr1", projectId: "p1", entity: "issue", ids: ["a", "b"], from: "2026-01-01", to: "2026-06-30" };
    expect(trendQueryKey(q)).toEqual(["trend", "spi", "week", "pr1", "p1", "issue", "a,b", "2026-01-01", "2026-06-30"]);
  });
});

const series: TrendSeries = { metric: "cpi", grain: "month", from: "", to: "", points: [], available: false, reason: "no retention" };

describe("useTrend", () => {
  it("builds a bare URL for a metric-only query", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTrend({ metric: "cpi" }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/history/trends/cpi");
  });

  it("encodes every query param into the URL", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const q: TrendQuery = { metric: "spi", grain: "week", programmeId: "pr1", projectId: "p1", entity: "issue", ids: ["a", "b"], from: "2026-01-01", to: "2026-06-30" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTrend(q), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const url = new URL(fetchMock.mock.calls[0]![0] as string, "https://x.test");
    expect(url.pathname).toBe("/api/history/trends/spi");
    expect(url.searchParams.get("grain")).toBe("week");
    expect(url.searchParams.get("programmeId")).toBe("pr1");
    expect(url.searchParams.get("projectId")).toBe("p1");
    expect(url.searchParams.get("entity")).toBe("issue");
    expect(url.searchParams.get("ids")).toBe("a,b");
    expect(url.searchParams.get("from")).toBe("2026-01-01");
    expect(url.searchParams.get("to")).toBe("2026-06-30");
  });

  it("omits an empty ids array from the URL", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTrend({ metric: "cpi", ids: [] }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/history/trends/cpi");
  });

  it("does not fetch when disabled", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify(series), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useTrend({ metric: "cpi" }, false), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
