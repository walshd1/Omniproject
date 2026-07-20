import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  wikiRoomId, wikiSpacesKey, wikiDocsKey, wikiDocKey,
  useWikiSpaces, useWikiDocs, useWikiDoc,
  useCreateWikiDoc, useSaveWikiDoc, useDeleteWikiDoc,
  buildDocTree, flattenDocTree, descendantIds, type WikiDocSummary,
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

describe("page tree (buildDocTree / flattenDocTree / descendantIds)", () => {
  const doc = (id: string, parentId: string | null, title = id): WikiDocSummary =>
    ({ id, spaceId: "s1", parentId, slug: id, title, updatedAt: "" });

  it("nests children under parents and orders siblings by title", () => {
    const roots = buildDocTree([doc("a", null, "Alpha"), doc("b", null, "Beta"), doc("a1", "a", "Alpha child")]);
    expect(roots.map((r) => r.id)).toEqual(["a", "b"]); // Alpha before Beta
    expect(roots[0]!.children.map((c) => c.id)).toEqual(["a1"]);
    expect(roots[0]!.depth).toBe(0);
    expect(roots[0]!.children[0]!.depth).toBe(1);
  });

  it("flattens to parent-before-children order with depth tags", () => {
    const flat = flattenDocTree(buildDocTree([doc("a", null), doc("a1", "a"), doc("a1x", "a1")]));
    expect(flat.map((n) => [n.id, n.depth])).toEqual([["a", 0], ["a1", 1], ["a1x", 2]]);
  });

  it("treats a dangling, self, or cyclic parent as a root (never drops a page)", () => {
    // dangling parent (ghost), self-parent, and a 2-cycle (x↔y) all degrade to roots.
    const flat = flattenDocTree(buildDocTree([doc("d", "ghost"), doc("s", "s"), doc("x", "y"), doc("y", "x")]));
    expect(new Set(flat.map((n) => n.id))).toEqual(new Set(["d", "s", "x", "y"]));
    expect(flat.every((n) => n.depth === 0)).toBe(true); // all promoted to roots, none lost
  });

  it("collects the descendant ids of a subtree (for cycle-free parent options)", () => {
    const docs = [doc("a", null), doc("a1", "a"), doc("a1x", "a1"), doc("b", null)];
    expect(descendantIds(docs, "a")).toEqual(new Set(["a1", "a1x"]));
    expect(descendantIds(docs, "b")).toEqual(new Set());
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
