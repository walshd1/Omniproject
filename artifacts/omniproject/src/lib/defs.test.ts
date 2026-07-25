import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { featuresQueryKey } from "./features";
import {
  pickActiveDef,
  primitiveSlot,
  defsKey,
  defKey,
  useDef,
  useDefs,
  useResolvedDefs,
  useActiveDefs,
  useValidateDef,
  useImportDef,
  useUpdateDef,
  useDeleteDef,
  type ResolvedBinding,
  type StoredDef,
} from "./defs";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // The /api/defs/* read hooks gate their fetch on the `defImporter` feature (useDefImporterEnabled),
  // which reads false while the features query is unseeded — enable it so the hook tests fire.
  qc.setQueryData(featuresQueryKey({}), [{ id: "defImporter", kind: "module", label: "Def importer", description: "", enabled: true, loaded: true, needsRestart: false }]);
  return qc;
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

/**
 * pickActiveDef (roadmap X.12 slice 3) — the pure client helper that maps a slot's server-resolved winner
 * (defId) to the actual def object from the resolved list, or null (→ system default). The winner LOGIC lives
 * server-side (def-binding); this only looks up the chosen id.
 */
const def = (id: string): StoredDef & { payload: unknown } => ({
  id, kind: "screen", name: id, storage: id.split("~")[0]!, createdBy: null,
  createdAt: "", updatedAt: "", rowVersion: 1, payload: { id },
});
const resolved = [def("org~a"), def("user~b"), def("system~c")];

describe("pickActiveDef", () => {
  it("returns the def whose id the binding selected", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "user~b", locked: false, source: "user" } };
    expect(pickActiveDef(resolved, active, "screens")?.id).toBe("user~b");
  });

  it("returns null when there's no binding for the slot (→ system default)", () => {
    expect(pickActiveDef(resolved, {}, "screens")).toBeNull();
    const active: Record<string, ResolvedBinding> = { screens: { defId: null, locked: false, source: "default" } };
    expect(pickActiveDef(resolved, active, "screens")).toBeNull();
  });

  it("returns null when the selected id isn't in the visible resolved list (fail-safe → default)", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "project~gone", locked: false, source: "project" } };
    expect(pickActiveDef(resolved, active, "screens")).toBeNull();
  });

  it("tolerates a non-array resolved payload (fetch-mock / loading) without throwing", () => {
    const active: Record<string, ResolvedBinding> = { screens: { defId: "user~b", locked: false, source: "user" } };
    expect(pickActiveDef(undefined, active, "screens")).toBeNull();
    expect(pickActiveDef({} as unknown as StoredDef[] & { payload: unknown }[], active, "screens")).toBeNull();
  });
});

describe("keys + primitiveSlot", () => {
  it("are the stable cache keys and namespaced primitive slot", () => {
    expect(defsKey).toEqual(["defs"]);
    expect(defKey("d1")).toEqual(["def", "d1"]);
    expect(primitiveSlot("acme-tile")).toBe("primitive:acme-tile");
  });
});

describe("useDef", () => {
  it("GETs the encoded id-scoped def", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "user~x", kind: "screen", name: "S", payload: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDef("user x"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/user%20x");
  });

  it("stays disabled (no fetch) when the id is undefined", () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDef(undefined), { wrapper: wrapper(newClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useDefs", () => {
  it("GETs the bare listing when unfiltered", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs");
  });

  it("appends a kind + projectId query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefs("form", "p1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs?kind=form&projectId=p1");
  });
});

describe("useResolvedDefs", () => {
  it("GETs the resolved-by-kind endpoint with the scope query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useResolvedDefs("primitive", "p1", "pr1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/resolved/primitive?projectId=p1&programmeId=pr1");
  });

  it("stays disabled when `enabled` is false", () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useResolvedDefs("form", undefined, undefined, false), { wrapper: wrapper(newClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useActiveDefs", () => {
  it("GETs the active-winner map, with no query string when unscoped", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActiveDefs(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/active");
  });

  it("appends the project + programme scope", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useActiveDefs("p1", "pr1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/active?projectId=p1&programmeId=pr1");
  });
});

describe("useValidateDef", () => {
  it("POSTs the payload to the dry-run validator", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ valid: true, errors: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useValidateDef(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ kind: "form", payload: { id: "x" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs/validate");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ kind: "form", payload: { id: "x" } });
  });
});

describe("useImportDef", () => {
  it("POSTs the import request and invalidates the defs cache", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "org~x" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useImportDef(), { wrapper: wrapper(client) });
    result.current.mutate({ kind: "form", storage: "org", name: "F", payload: {} });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs");
    expect((opts as RequestInit).method).toBe("POST");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: defsKey });
  });
});

describe("useUpdateDef", () => {
  it("PUTs name + payload to the id-scoped endpoint and invalidates", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "org~x" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateDef(), { wrapper: wrapper(client) });
    result.current.mutate({ id: "org x", name: "New", payload: { a: 1 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs/org%20x");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ name: "New", payload: { a: 1 } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: defsKey });
  });

  it("omits the name field from the body when no name is supplied", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "org~x" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUpdateDef(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "d1", payload: { a: 1 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body))).toEqual({ payload: { a: 1 } });
  });
});

describe("useDeleteDef", () => {
  it("DELETEs the encoded def and invalidates the defs cache", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteDef(), { wrapper: wrapper(client) });
    result.current.mutate("org x");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs/org%20x");
    expect((opts as RequestInit).method).toBe("DELETE");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: defsKey });
  });

  it("surfaces the server error when the delete fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 403)));
    const { result } = renderHook(() => useDeleteDef(), { wrapper: wrapper(newClient()) });
    result.current.mutate("d1");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("nope");
  });
});
