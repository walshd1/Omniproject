import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  usersKey,
  useUsers,
  createUser,
  updateUser,
  setUserPassword,
  deleteUser,
  type LocalUserView,
} from "./users";

/**
 * users.ts is the admin client seam over `/api/users`: the `usersKey` query key, the `useUsers`
 * read hook (which folds a 404 into an "unavailable" sentinel rather than an error), and four
 * plain mutation helpers. The hook is driven through a retry-disabled QueryClient with a stubbed
 * `fetch`; each mutation is called directly and asserted on the method/URL/body it sends and the
 * error it surfaces.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function user(over: Partial<LocalUserView> = {}): LocalUserView {
  return {
    id: "local:1", userName: "root", displayName: "Root", email: "", groups: ["omni-admins"],
    active: true, hasPassword: true, createdAt: "", updatedAt: "", ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function lastInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  return fetchMock.mock.calls.at(-1)![1] as RequestInit;
}

afterEach(() => vi.restoreAllMocks());

describe("usersKey", () => {
  it("is the stable roster query key", () => {
    expect(usersKey).toEqual(["users"]);
  });
});

describe("useUsers", () => {
  it("fetches the roster same-origin and marks it available with the users array", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ users: [user()] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/users");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe("same-origin");
    expect(result.current.data).toEqual({ available: true, users: [user()] });
  });

  it("folds a 404 into an unavailable sentinel (deployment has no encrypted store)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ available: false, users: [] });
  });

  it("coerces a non-array `users` body to an empty list", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ users: "nope" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ available: true, users: [] });
  });

  it("throws the status on a non-404 error response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUsers(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("500");
  });
});

describe("createUser", () => {
  it("POSTs the input to /api/users", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ user: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);
    await createUser({ userName: "alice", displayName: "Alice", email: "a@x", groups: ["viewers"], password: "pw" });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/users");
    const init = lastInit(fetchMock);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ userName: "alice", displayName: "Alice", email: "a@x", groups: ["viewers"], password: "pw" });
  });

  it("surfaces the server error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "taken" }, 409)));
    await expect(createUser({ userName: "alice" })).rejects.toThrow("taken");
  });

  it("falls back to the caller's message when the error body is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(createUser({ userName: "alice" })).rejects.toThrow("Could not create the user.");
  });
});

describe("updateUser", () => {
  it("PATCHes the id-scoped endpoint with the patch body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await updateUser("local:1", { active: false });
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/users/local%3A1");
    const init = lastInit(fetchMock);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ active: false });
  });
});

describe("setUserPassword", () => {
  it("POSTs the password to the /password sub-resource", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await setUserPassword("a b", "secret8!");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/users/a%20b/password");
    const init = lastInit(fetchMock);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ password: "secret8!" });
  });
});

describe("deleteUser", () => {
  it("DELETEs the id-scoped endpoint with no body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await deleteUser("local:1");
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/users/local%3A1");
    const init = lastInit(fetchMock);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("surfaces the delete failure message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    await expect(deleteUser("local:1")).rejects.toThrow("Could not delete the user.");
  });
});
