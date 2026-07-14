import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useHealthFindings, runHealthWatch, type HealthFinding } from "./health-watch";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const finding: HealthFinding = {
  ruleId: "stale", projectId: "p1", projectName: "Alpha", severity: "warning", message: "no activity", at: "2026-07-01T00:00:00Z",
};

afterEach(() => vi.restoreAllMocks());

describe("useHealthFindings", () => {
  it("reads the findings envelope from the watch endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ findings: [finding] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useHealthFindings(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data!.findings).toEqual([finding]);
  });
});

describe("runHealthWatch", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs a scan and returns the raised findings", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ findings: [finding] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runHealthWatch()).resolves.toEqual([finding]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/health-watch/run");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).credentials).toBe("same-origin");
  });

  it("throws the server error message on a non-ok scan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(runHealthWatch()).rejects.toThrow("forbidden");
  });

  it("throws a fallback with the status when the error body is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u?: RequestInfo | URL, _i?: RequestInit) => new Response("nope", { status: 500 })));
    await expect(runHealthWatch()).rejects.toThrow("Scan failed (500)");
  });
});
