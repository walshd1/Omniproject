import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  CONTAINMENT_INFO,
  SOURCE_LABEL,
  useAiContainment,
  useAutonomousGrants,
  setAiKill,
  relaxContainment,
  type AiContainment,
} from "./containment";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

const LEVELS: AiContainment[] = ["off", "local", "remote", "public"];

describe("CONTAINMENT_INFO / SOURCE_LABEL", () => {
  it("has a label/cls/note entry for every containment level", () => {
    for (const level of LEVELS) {
      expect(CONTAINMENT_INFO[level]).toMatchObject({ label: expect.any(String), cls: expect.any(String), note: expect.any(String) });
    }
  });

  it("has a source label for every containment level", () => {
    for (const level of LEVELS) expect(typeof SOURCE_LABEL[level]).toBe("string");
  });

  it("public is stricter framing than off (full vs minimal containment)", () => {
    expect(CONTAINMENT_INFO.public.label).toMatch(/full/i);
    expect(CONTAINMENT_INFO.off.label).toMatch(/minimal/i);
  });
});

describe("useAiContainment", () => {
  it("fetches the unscoped endpoint when no surface is given", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ level: "remote", source: "remote" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAiContainment(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/ai/containment");
    expect(result.current.data).toEqual({ level: "remote", source: "remote" });
  });

  it("scopes the query to a surface, URL-encoded", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ level: "local", source: "local" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAiContainment("copilot chat"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/ai/containment?surface=copilot%20chat");
  });
});

describe("useAutonomousGrants", () => {
  it("fetches the full governance shape when enabled (default)", async () => {
    const payload = { level: "remote", source: "remote", relax: "local", grants: [{ actorId: "a1", actions: ["read"] }], aiKill: false };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAutonomousGrants(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("/api/governance/autonomous");
    expect(result.current.data).toEqual(payload);
  });

  it("skips the fetch entirely when enabled: false", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAutonomousGrants(false), { wrapper: wrapper(newClient()) });
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });
});

describe("setAiKill", () => {
  it("PUTs { engage } to the ai-kill endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await setAiKill(true);
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/governance/ai-kill");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ engage: true });
  });

  it("releases the kill switch with engage: false", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await setAiKill(false);
    const [, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ engage: false });
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not admin" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(setAiKill(true)).rejects.toThrow("not admin");
  });

  it("maps a step_up_required code to that exact message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "step_up_required" }), { status: 403, headers: { "Content-Type": "application/json" } })));
    await expect(setAiKill(true)).rejects.toThrow("step_up_required");
  });
});

describe("relaxContainment", () => {
  it("PUTs { level } to the containment endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await relaxContainment("local");
    const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/governance/containment");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ level: "local" });
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "cannot relax below floor" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(relaxContainment("off")).rejects.toThrow("cannot relax below floor");
  });

  it("falls back to a status-coded message when the body carries no error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(relaxContainment("public")).rejects.toThrow("500");
  });
});
