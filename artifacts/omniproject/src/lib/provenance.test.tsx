import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useProvenanceChain, shortMac, type ProvenanceChain } from "./provenance";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("shortMac", () => {
  it("truncates a 64-char hex MAC to its first 10 characters", () => {
    const mac = "a".repeat(64);
    expect(shortMac(mac)).toBe("a".repeat(10));
    expect(shortMac(mac)).toHaveLength(10);
  });

  it("returns an empty string for a short mac (returns it as-is when under 10 chars)", () => {
    expect(shortMac("abc")).toBe("abc");
  });

  it("returns an empty string for null", () => {
    expect(shortMac(null)).toBe("");
  });
});

describe("useProvenanceChain", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the recent broker-call chain and its integrity verdict", async () => {
    const payload: ProvenanceChain = {
      entries: [
        {
          callId: "c1", seq: 1, hop: "invoke", action: "list_projects", actor: "ada",
          sessionMac: "sm1", tMono: "0", elapsedMs: 5, tWall: "2026-01-01T00:00:00.000Z",
          kver: 1, contentMac: "cm1", prevMac: null, mac: "m1",
        },
      ],
      chain: { ok: true, length: 1 },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useProvenanceChain(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual(payload));
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/provenance");
  });

  it("surfaces isError when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { result } = renderHook(() => useProvenanceChain(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
