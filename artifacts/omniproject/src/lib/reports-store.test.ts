import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { REPORTS, type ReportDefinition } from "@workspace/backend-catalogue";
import { useReports, findReport, reportsStoreQueryKey } from "./reports-store";

/**
 * The per-deployment REPORT DEFINITION store: the bundled catalogue is the initialData + fail-soft fallback,
 * so cards render immediately and never flash empty when the `/api/reports` request is slow, fails, or comes
 * back empty. We seed via a stubbed fetch and drive an explicit refetch (initialData keeps the query fresh,
 * so nothing is fetched on mount).
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

const custom = (id: string): ReportDefinition => ({ ...REPORTS[0]!, id, label: id });

describe("reportsStoreQueryKey", () => {
  it("is the stable cache key", () => {
    expect(reportsStoreQueryKey).toEqual(["reports-store"]);
  });
});

describe("useReports", () => {
  it("renders the bundled catalogue immediately from initialData (no fetch on mount)", () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reports: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useReports(), { wrapper: wrapper(newClient()) });
    expect(result.current).toBe(REPORTS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unwraps the store's `reports` envelope when the request resolves", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reports: [custom("bespoke")] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const { result } = renderHook(() => useReports(), { wrapper: wrapper(client) });
    await act(async () => { await client.refetchQueries({ queryKey: reportsStoreQueryKey }); });
    await waitFor(() => expect(result.current.some((r) => r.id === "bespoke")).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/reports");
  });

  it("falls back to the bundled catalogue when the store reports nothing (null envelope)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reports: null }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const { result } = renderHook(() => useReports(), { wrapper: wrapper(client) });
    await act(async () => { await client.refetchQueries({ queryKey: reportsStoreQueryKey }); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBe(REPORTS);
  });
});

describe("findReport", () => {
  it("returns the definition matching the id from the supplied list", () => {
    const list = [custom("a"), custom("b")];
    expect(findReport(list, "b")!.id).toBe("b");
  });

  it("falls back to the bundled catalogue when the id isn't in the list", () => {
    const builtinId = REPORTS[0]!.id;
    expect(findReport([], builtinId)!.id).toBe(builtinId);
  });

  it("returns undefined for an id in neither the list nor the catalogue", () => {
    expect(findReport([], "no-such-report-xyz")).toBeUndefined();
  });
});
