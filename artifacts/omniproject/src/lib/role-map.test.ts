import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  roleMapKey,
  useRoleMap,
  saveRoleMap,
  rollbackRoleMap,
  parseGroups,
  type RoleMapState,
} from "./role-map";

/**
 * role-map.ts is the admin client seam over `/api/admin/role-map`: the `roleMapKey` query key, the
 * `useRoleMap` read hook, the `saveRoleMap` PUT + `rollbackRoleMap` POST, and the pure `parseGroups`
 * splitter. The hook is driven through a retry-disabled QueryClient with a stubbed `fetch`; the
 * mutations are called directly and asserted on the method/URL/body they send.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function state(): RoleMapState {
  return {
    roles: ["viewer", "admin"],
    mapping: [
      { role: "viewer", claims: ["staff"], source: "env" },
      { role: "admin", claims: ["omni-admins"], source: "override" },
    ],
    rollbackAvailable: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("roleMapKey", () => {
  it("is the stable admin role-map query key", () => {
    expect(roleMapKey).toEqual(["admin", "role-map"]);
  });
});

describe("useRoleMap", () => {
  it("fetches the mapping same-origin", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useRoleMap(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/role-map");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe("same-origin");
    expect(result.current.data?.mapping).toHaveLength(2);
  });

  it("surfaces the server error on a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 403)));
    const { result } = renderHook(() => useRoleMap(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("nope");
  });
});

describe("saveRoleMap", () => {
  it("PUTs the {role: groups[]} map to /api/admin/role-map", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal("fetch", fetchMock);
    const groups = { viewer: ["staff"], admin: ["omni-admins"] };
    const res = await saveRoleMap(groups);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/admin/role-map");
    const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(groups);
    expect(res.rollbackAvailable).toBe(true);
  });

  it("maps a step-up requirement to the step_up_required error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "step_up_required" }, 403)));
    await expect(saveRoleMap({ viewer: [] })).rejects.toThrow("step_up_required");
  });
});

describe("rollbackRoleMap", () => {
  it("POSTs to the /rollback endpoint with an empty body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal("fetch", fetchMock);
    await rollbackRoleMap();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/admin/role-map/rollback");
    const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({});
  });
});

describe("parseGroups", () => {
  it("splits on commas, whitespace and newlines", () => {
    expect(parseGroups("a, b\nc d")).toEqual(["a", "b", "c", "d"]);
  });

  it("trims, lower-cases and de-dupes", () => {
    expect(parseGroups("  Admins , admins\n  STAFF ")).toEqual(["admins", "staff"]);
  });

  it("drops empty fragments and returns [] for a blank string", () => {
    expect(parseGroups("   ,,  \n ")).toEqual([]);
    expect(parseGroups("")).toEqual([]);
  });
});
