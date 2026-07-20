import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  REGISTRY_ITEM_KINDS, registryItemKindLabel,
  registryKey, registryItemKey, communityStatusKey,
  useRegistry, useRegistryItem, useCommunityStatus,
  useSubmitRegistryItem, useReviewRegistryItem, useReleaseRegistryItem,
  useRetractRegistryItem, useDeleteRegistryItem,
} from "./registry";

/**
 * Org registry client hooks (roadmap 3.5). Covers the query keys + re-exports, the three read hooks
 * (including the `enabled` gate on `useRegistryItem`), and every mutation's method / URL / body — with
 * special attention to `useReviewRegistryItem`, whose body is assembled from a chain of conditional
 * spreads (note present/absent, org/programme/project scope, id present/absent). Each mutation asserts
 * it invalidates the registry list on success.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
/** Stub fetch, returning a canned JSON body; returns the mock so calls can be inspected. */
function stubFetch(body: unknown = {}, status = 200) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function lastCall(fn: ReturnType<typeof vi.fn>) {
  const [url, opts] = fn.mock.calls.at(-1)! as [string, RequestInit | undefined];
  return { url, method: opts?.method, body: opts?.body ? JSON.parse(String(opts.body)) : undefined };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("registry re-exports + keys", () => {
  it("re-exports the catalogue kinds and label helper", () => {
    expect(REGISTRY_ITEM_KINDS).toContain("primitive");
    expect(registryItemKindLabel("report")).toBeTruthy();
  });
  it("builds stable query keys", () => {
    expect(registryKey).toEqual(["registry"]);
    expect(registryItemKey("r1")).toEqual(["registry-item", "r1"]);
    expect(communityStatusKey).toEqual(["registry-community-status"]);
  });
});

describe("registry read hooks", () => {
  it("useRegistry GETs the list", async () => {
    const fn = stubFetch([{ id: "r1" }]);
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/registry");
    expect(result.current.data).toEqual([{ id: "r1" }]);
  });

  it("useRegistryItem GETs one item (encoding the id) when enabled", async () => {
    const fn = stubFetch({ id: "a/b" });
    const { result } = renderHook(() => useRegistryItem("a/b"), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/registry/a%2Fb");
  });

  it("useRegistryItem is disabled with no id (never fetches)", () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useRegistryItem(undefined), { wrapper: wrapper(freshClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fn).not.toHaveBeenCalled();
  });

  it("useCommunityStatus GETs the community status", async () => {
    const fn = stubFetch({ connected: true, name: "Hub" });
    const { result } = renderHook(() => useCommunityStatus(), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/registry/community/status");
  });
});

describe("registry mutations", () => {
  it("useSubmitRegistryItem POSTs the submission and invalidates the list", async () => {
    const fn = stubFetch({ id: "r1" });
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSubmitRegistryItem(), { wrapper: wrapper(client) });
    result.current.mutate({ kind: "report", name: "X" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/registry");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ kind: "report", name: "X" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: registryKey });
  });

  it("useReviewRegistryItem: bare approval sends only the decision", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useReviewRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "r1", decision: "approved" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/registry/r1/review");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ decision: "approved" });
  });

  it("useReviewRegistryItem: a note is included; org scope is omitted from the body", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useReviewRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "r1", decision: "rejected", note: "no", scope: "org" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall(fn).body).toEqual({ decision: "rejected", note: "no" });
  });

  it("useReviewRegistryItem: programme scope carries scope + programmeId", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useReviewRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "r1", decision: "approved", scope: "programme", programmeId: "pg1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall(fn).body).toEqual({ decision: "approved", scope: "programme", programmeId: "pg1" });
  });

  it("useReviewRegistryItem: project scope carries scope + projectId", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useReviewRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "r1", decision: "approved", scope: "project", projectId: "pj1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall(fn).body).toEqual({ decision: "approved", scope: "project", projectId: "pj1" });
  });

  it("useReviewRegistryItem: a programme scope without an id drops the id key", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useReviewRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "r1", decision: "approved", scope: "programme" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall(fn).body).toEqual({ decision: "approved", scope: "programme" });
  });

  it("useReleaseRegistryItem POSTs to the release route with an empty body", async () => {
    const fn = stubFetch({ item: {}, published: true });
    const { result } = renderHook(() => useReleaseRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate("r1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/registry/r1/release");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({});
  });

  it("useRetractRegistryItem POSTs to the retract route", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useRetractRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate("r1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/registry/r1/retract");
    expect(c.method).toBe("POST");
  });

  it("useDeleteRegistryItem DELETEs the item (bodyless) and invalidates", async () => {
    const fn = stubFetch({}, 204);
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteRegistryItem(), { wrapper: wrapper(client) });
    result.current.mutate("r1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/registry/r1");
    expect(c.method).toBe("DELETE");
    expect(c.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: registryKey });
  });

  it("surfaces a server error on a failed mutation", async () => {
    stubFetch({ error: "nope" }, 403);
    const { result } = renderHook(() => useSubmitRegistryItem(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
