import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  EXTENSION_CONTRIBUTION_KINDS, contributionKindLabel,
  extensionsKey, extensionKey,
  useExtensions, useExtension,
  useInstallExtension, useSetExtensionStatus, useUninstallExtension,
} from "./marketplace";

/**
 * Plugin marketplace client hooks (roadmap 3.4). Covers the re-exported catalogue helpers, the query
 * keys, the two read hooks (list + one, with the `enabled` gate on `useExtension`), and every
 * mutation's method / URL / body plus its list invalidation.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function freshClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
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

describe("marketplace re-exports + keys", () => {
  it("re-exports the catalogue kinds and label helper", () => {
    expect(EXTENSION_CONTRIBUTION_KINDS).toContain("report");
    expect(contributionKindLabel("report")).toBe("Report");
  });
  it("builds stable query keys", () => {
    expect(extensionsKey).toEqual(["extensions"]);
    expect(extensionKey("e1")).toEqual(["extension", "e1"]);
  });
});

describe("marketplace read hooks", () => {
  it("useExtensions GETs the list", async () => {
    const fn = stubFetch([{ id: "e1" }]);
    const { result } = renderHook(() => useExtensions(), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/extensions");
  });

  it("useExtension GETs one extension (encoding the id) when enabled", async () => {
    const fn = stubFetch({ id: "a b" });
    const { result } = renderHook(() => useExtension("a b"), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/extensions/a%20b");
  });

  it("useExtension is disabled with no id", () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useExtension(undefined), { wrapper: wrapper(freshClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("marketplace mutations", () => {
  it("useInstallExtension POSTs the manifest and invalidates the list", async () => {
    const fn = stubFetch({ id: "e1" });
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useInstallExtension(), { wrapper: wrapper(client) });
    result.current.mutate({ name: "Pack" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/extensions");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ name: "Pack" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: extensionsKey });
  });

  it("useSetExtensionStatus POSTs the new status to the status route", async () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useSetExtensionStatus(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({ id: "e1", status: "disabled" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/extensions/e1/status");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ status: "disabled" });
  });

  it("useUninstallExtension DELETEs the extension (bodyless) and invalidates", async () => {
    const fn = stubFetch({}, 204);
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUninstallExtension(), { wrapper: wrapper(client) });
    result.current.mutate("e1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/extensions/e1");
    expect(c.method).toBe("DELETE");
    expect(c.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: extensionsKey });
  });

  it("surfaces a server error on a failed mutation", async () => {
    stubFetch({ error: "nope" }, 403);
    const { result } = renderHook(() => useInstallExtension(), { wrapper: wrapper(freshClient()) });
    result.current.mutate({});
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
