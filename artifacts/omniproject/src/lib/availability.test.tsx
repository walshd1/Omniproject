import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fieldVisible, useAvailability, useSetHiddenFields, availabilityQueryKey, type Availability } from "./availability";

const AVAIL: Availability = {
  source: "manifest",
  fields: ["title", "status"],
  available: ["title", "status", "dueDate"],
  hidden: ["dueDate"],
  tables: ["issues"],
  relationships: [],
};

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("fieldVisible", () => {
  it("is true for surfaced fields, false for curated/absent ones", () => {
    expect(fieldVisible(AVAIL, "title")).toBe(true);
    expect(fieldVisible(AVAIL, "dueDate")).toBe(false);
    expect(fieldVisible(AVAIL, "nope")).toBe(false);
  });
  it("defaults to true while availability is still loading", () => {
    expect(fieldVisible(undefined, "anything")).toBe(true);
  });
});

describe("useAvailability", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(AVAIL), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("fetches the availability descriptor", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useAvailability(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.fields).toEqual(["title", "status"]);
  });
});

describe("useSetHiddenFields", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });
  it("PATCHes the curation and invalidates availability on success", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    client.setQueryData(availabilityQueryKey, AVAIL);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetHiddenFields(), { wrapper: wrapper(client) });
    result.current.mutate(["dueDate"]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(url).toBe("/api/availability/curation");
    expect((opts as RequestInit).method).toBe("PATCH");
    expect(String((opts as RequestInit).body)).toContain("dueDate");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: availabilityQueryKey });
  });

  it("throws when the server rejects the curation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "nope" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const { result } = renderHook(() => useSetHiddenFields(), { wrapper: wrapper(client) });
    result.current.mutate(["x"]);
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
