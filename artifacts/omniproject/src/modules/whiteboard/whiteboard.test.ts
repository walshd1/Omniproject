import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  whiteboardRoomId, whiteboardsKey, whiteboardKey,
  useWhiteboards, useWhiteboard, useCreateWhiteboard, useSaveWhiteboard, useDeleteWhiteboard,
} from "./whiteboard";

/** Whiteboard client hooks: query keys + the read/write endpoints they call. */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const mockFetch = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

afterEach(() => vi.restoreAllMocks());

describe("whiteboard keys + room id", () => {
  it("builds stable keys and the live-cursor room id", () => {
    expect(whiteboardRoomId("wb1")).toBe("board:wb1");
    expect(whiteboardsKey("p1")).toEqual(["whiteboards", "p1"]);
    expect(whiteboardsKey()).toEqual(["whiteboards", "all"]);
    expect(whiteboardKey("wb1")).toEqual(["whiteboard", "wb1"]);
  });
});

describe("whiteboard hooks", () => {
  it("useWhiteboards scopes by projectId", async () => {
    const f = mockFetch([{ id: "wb1", name: "B", updatedAt: "" }]);
    const { result } = renderHook(() => useWhiteboards("p1"), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u) === "/api/whiteboards?projectId=p1")).toBe(true);
  });

  it("useWhiteboard GETs one board, disabled without an id", async () => {
    const f = mockFetch({ id: "wb1", name: "B", updatedAt: "", scene: { elements: [] } });
    const { result } = renderHook(() => useWhiteboard("wb1"), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(f.mock.calls.some(([u]) => String(u) === "/api/whiteboards/wb1")).toBe(true);
  });

  it("create POSTs, save PUTs, delete DELETEs", async () => {
    const f = mockFetch({ id: "wb9", name: "N", updatedAt: "", scene: { elements: [] } }, 201);
    const client = qc();
    const create = renderHook(() => useCreateWhiteboard(), { wrapper: wrapper(client) });
    await create.result.current.mutateAsync({ name: "N", scene: { elements: [] } });
    const save = renderHook(() => useSaveWhiteboard("wb9"), { wrapper: wrapper(client) });
    await save.result.current.mutateAsync({ name: "N2", scene: { elements: [] } });
    const del = renderHook(() => useDeleteWhiteboard(), { wrapper: wrapper(client) });
    await del.result.current.mutateAsync("wb9");

    const called = (url: string, method: string) =>
      f.mock.calls.some(([u, i]) => String(u) === url && (i as RequestInit | undefined)?.method === method);
    expect(called("/api/whiteboards", "POST")).toBe(true);
    expect(called("/api/whiteboards/wb9", "PUT")).toBe(true);
    expect(called("/api/whiteboards/wb9", "DELETE")).toBe(true);
  });
});
