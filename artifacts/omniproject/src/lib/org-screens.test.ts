import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockFetchRouter, resetFetchMock } from "../test/utils";
import {
  useOrgScreenDefs,
  useLegacyOrgScreenDefs,
  useDrainLegacyScreenDefs,
  useSaveScreenOverride,
  useResolvedScreens,
  useScreenDef,
  useRoutedScreens,
  screenDefsResolvedKey,
  legacyScreenDefsKey,
  screenDefs,
  type OrgScreenDef,
} from "./org-screens";
import { settingsQueryKey } from "./settings-query";

/**
 * Org screen-def client + resolution. The effective OVERRIDE set comes from `/api/screen-defs/resolved`
 * (def store ∪ legacy bridge), merged over the built-in catalogue; the ONE write path is the importer
 * (PUT an existing org `screen` def, else POST a new one), then the resolved-screens cache is invalidated.
 */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** A minimal screen catalogue entry — enough to exercise merge/resolve/save; the render model is cast-trusted. */
const screen = (over: Partial<OrgScreenDef> & { id: string }): OrgScreenDef =>
  ({ label: over.id, layout: { panels: [] }, ...over }) as unknown as OrgScreenDef;

afterEach(() => resetFetchMock());

const BUILTIN_ID = screenDefs()[0]!.id;

describe("useOrgScreenDefs", () => {
  it("GETs the resolved overrides and unwraps `screenDefs`", async () => {
    const calls = mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: { screenDefs: [screen({ id: "kanban" })] } } });
    const { result } = renderHook(() => useOrgScreenDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((s) => s.id)).toEqual(["kanban"]);
    expect(calls[0]!.url).toContain("/api/screen-defs/resolved");
  });

  it("falls back to [] when the envelope omits `screenDefs`", async () => {
    mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: {} } });
    const { result } = renderHook(() => useOrgScreenDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useLegacyOrgScreenDefs", () => {
  it("GETs the legacy settings slice and unwraps `screenDefs`", async () => {
    const calls = mockFetchRouter({ "/api/screen-defs": { ok: true, body: { screenDefs: [screen({ id: "old" })] } } });
    const { result } = renderHook(() => useLegacyOrgScreenDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((s) => s.id)).toEqual(["old"]);
    expect(calls[0]!.url).toContain("/api/screen-defs");
  });

  it("falls back to [] when the envelope omits `screenDefs`", async () => {
    mockFetchRouter({ "/api/screen-defs": { ok: true, body: {} } });
    const { result } = renderHook(() => useLegacyOrgScreenDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useDrainLegacyScreenDefs", () => {
  it("PUTs an empty legacy slice and invalidates the legacy + settings caches", async () => {
    const calls = mockFetchRouter({ "/api/screen-defs": { ok: true, body: {} } });
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDrainLegacyScreenDefs(), { wrapper: wrapper(client) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const put = calls.find((c) => (c.init?.method ?? "GET") === "PUT")!;
    expect(put.url).toContain("/api/screen-defs");
    expect(JSON.parse(String(put.init!.body))).toEqual({ screenDefs: [] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: legacyScreenDefsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsQueryKey });
  });
});

describe("useSaveScreenOverride", () => {
  const resolvedDef = {
    id: "org~1", kind: "screen", name: "Home", storage: "org", createdBy: null,
    createdAt: "", updatedAt: "", rowVersion: 1, payload: screen({ id: "home", label: "Home" }),
  };

  it("PUTs (updates) the existing org def in place when one already overrides that screen", async () => {
    const calls = mockFetchRouter({ "/api/defs/resolved/screen": { ok: true, body: [resolvedDef] } });
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveScreenOverride(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.orgDefs.length).toBe(1));
    expect(result.current.scopedIdByScreenId.get("home")).toBe("org~1");
    await act(async () => { await result.current.save(screen({ id: "home", label: "Home v2" })); });
    const put = calls.find((c) => (c.init?.method ?? "GET") === "PUT")!;
    expect(put.url).toBe("/api/defs/org~1");
    expect(JSON.parse(String(put.init!.body))).toMatchObject({ name: "Home v2" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: screenDefsResolvedKey });
  });

  it("POSTs (imports) a new org def when the screen has no existing override", async () => {
    const calls = mockFetchRouter({ "/api/defs/resolved/screen": { ok: true, body: [resolvedDef] } });
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveScreenOverride(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.orgDefs.length).toBe(1));
    await act(async () => { await result.current.save(screen({ id: "brand-new", label: "Brand New" })); });
    const post = calls.find((c) => c.url.endsWith("/api/defs") && (c.init?.method ?? "GET") === "POST")!;
    expect(post.url).toBe("/api/defs");
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ kind: "screen", storage: "org", name: "Brand New" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: screenDefsResolvedKey });
  });

  it("falls back to the screen id for the def name when the def carries no label", async () => {
    const calls = mockFetchRouter({ "/api/defs/resolved/screen": { ok: true, body: [] } });
    const { result } = renderHook(() => useSaveScreenOverride(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.saving).toBe(false));
    await act(async () => { await result.current.save({ id: "nameless" } as unknown as OrgScreenDef); });
    const post = calls.find((c) => c.url.endsWith("/api/defs") && (c.init?.method ?? "GET") === "POST")!;
    expect(JSON.parse(String(post.init!.body))).toMatchObject({ name: "nameless" });
  });

  it("treats a non-array resolved payload as no org defs", async () => {
    mockFetchRouter({ "/api/defs/resolved/screen": { ok: true, body: [] } });
    const { result } = renderHook(() => useSaveScreenOverride(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.saving).toBe(false));
    expect(result.current.orgDefs).toEqual([]);
    expect(result.current.scopedIdByScreenId.size).toBe(0);
  });
});

describe("useResolvedScreens", () => {
  it("merges built-ins with org overrides (override wins by id)", async () => {
    mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: { screenDefs: [screen({ id: BUILTIN_ID, label: "OVERRIDDEN" })] } } });
    const { result } = renderHook(() => useResolvedScreens(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.find((s) => s.id === BUILTIN_ID)!.label).toBe("OVERRIDDEN"));
    // A net-new override is appended, not lost.
    expect(result.current.length).toBe(screenDefs().length);
  });
});

describe("useScreenDef", () => {
  it("resolves a built-in by id when there's no override", async () => {
    mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: { screenDefs: [] } } });
    const { result } = renderHook(() => useScreenDef(BUILTIN_ID), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current?.id).toBe(BUILTIN_ID));
  });

  it("returns undefined for an unknown id", async () => {
    mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: { screenDefs: [] } } });
    const { result } = renderHook(() => useScreenDef("no-such-screen-xyz"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});

describe("useRoutedScreens", () => {
  it("returns only screens that declare a non-empty route", async () => {
    mockFetchRouter({ "/api/screen-defs/resolved": { ok: true, body: { screenDefs: [screen({ id: "routed-x", route: "/routed-x" })] } } });
    const { result } = renderHook(() => useRoutedScreens(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.some((s) => s.id === "routed-x")).toBe(true));
    expect(result.current.every((s) => typeof s.route === "string" && s.route.length > 0)).toBe(true);
  });
});
