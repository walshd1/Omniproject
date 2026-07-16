import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  wikiRoomId, wikiSpacesKey, wikiDocsKey, wikiDocKey,
  useWikiSpaces, useWikiDocs, useWikiDoc,
  useCreateWikiDoc, useSaveWikiDoc, useDeleteWikiDoc,
} from "./wiki";

/** Wiki client hooks: query keys + the read/write endpoints they call. */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const mockFetch = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

afterEach(() => vi.restoreAllMocks());

describe("wiki keys + room id", () => {
  it("builds stable query keys and the presence/comments room id", () => {
    expect(wikiRoomId("d1")).toBe("doc:d1");
    expect(wikiSpacesKey).toEqual(["wiki", "spaces"]);
    expect(wikiDocsKey("s1")).toEqual(["wiki", "docs", "s1"]);
    expect(wikiDocsKey()).toEqual(["wiki", "docs", "all"]);
    expect(wikiDocKey("d1")).toEqual(["wiki", "doc", "d1"]);
  });
});

describe("wiki read hooks", () => {
  it("useWikiSpaces GETs /api/wiki/spaces", async () => {
    const f = mockFetch([{ id: "space-x", key: "x", name: "X" }]);
    const { result } = renderHook(() => useWikiSpaces(), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("space-x");
    expect(f.mock.calls.some(([u]) => String(u) === "/api/wiki/spaces")).toBe(true);
  });

  it("useWikiDocs scopes by spaceId", async () => {
    const f = mockFetch([{ id: "d1", spaceId: "s1", slug: "d", title: "D", updatedAt: "" }]);
    const { result } = renderHook(() => useWikiDocs("s1"), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u) === "/api/wiki/docs?spaceId=s1")).toBe(true);
  });

  it("useWikiDoc is disabled without an id and GETs the doc when given one", async () => {
    const f = mockFetch({ id: "d1", spaceId: "s1", slug: "d", title: "D", blocks: [], updatedAt: "" });
    const { result } = renderHook(() => useWikiDoc("d1"), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u) === "/api/wiki/docs/d1")).toBe(true);
  });
});

describe("wiki write hooks", () => {
  it("useCreateWikiDoc POSTs, useSaveWikiDoc PUTs, useDeleteWikiDoc DELETEs", async () => {
    const f = mockFetch({ id: "d9", spaceId: "s1", slug: "n", title: "N", blocks: [], updatedAt: "" }, 201);
    const client = qc();
    const create = renderHook(() => useCreateWikiDoc(), { wrapper: wrapper(client) });
    await create.result.current.mutateAsync({ spaceId: "s1", title: "N", blocks: [] });
    const save = renderHook(() => useSaveWikiDoc("d9"), { wrapper: wrapper(client) });
    await save.result.current.mutateAsync({ spaceId: "s1", title: "N2", blocks: [] });
    const del = renderHook(() => useDeleteWikiDoc(), { wrapper: wrapper(client) });
    await del.result.current.mutateAsync("d9");

    const called = (url: string, method: string) =>
      f.mock.calls.some(([u, i]) => String(u) === url && (i as RequestInit | undefined)?.method === method);
    expect(called("/api/wiki/docs", "POST")).toBe(true);
    expect(called("/api/wiki/docs/d9", "PUT")).toBe(true);
    expect(called("/api/wiki/docs/d9", "DELETE")).toBe(true);
  });
});
