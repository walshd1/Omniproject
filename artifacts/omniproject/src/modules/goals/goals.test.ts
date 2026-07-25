import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { featuresQueryKey } from "../../lib/features";
import {
  goalsKey,
  goalKey,
  goalStatusTone,
  GOAL_STATUSES,
  useGoals,
  useGoal,
  useCreateGoal,
  useUpdateGoal,
  useCheckInGoal,
  useLinkGoal,
  useUnlinkGoal,
  useDeleteGoal,
  type Goal,
  type GoalStatus,
} from "./goals";

/**
 * goals.ts is the client seam over `/api/goals/*`: pure query-key + status-tone helpers plus the
 * react-query read/mutation hooks. The pure helpers are asserted directly; each hook is driven through
 * a retry-disabled QueryClient with a stubbed `fetch`, asserting the method/URL it hits and that its
 * `onSuccess` invalidates the right query keys.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function newClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // useGoals/useGoal gate their fetch on the `goals` feature, which reads false while the features query
  // is unseeded — enable it so the hook tests fire their request.
  qc.setQueryData(featuresQueryKey({}), [{ id: "goals", kind: "module", label: "Goals", description: "", enabled: true, loaded: true, needsRestart: false }]);
  return qc;
}

function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: "g1", title: "Grow adoption", status: "on_track", progressPct: 40,
    keyResultCount: 1, checkInCount: 0, lastCheckInAt: null, linkCount: 0, updatedAt: "",
    description: null, keyResults: [], checkins: [], links: [], version: 1, createdAt: "", updatedBy: null,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("goalsKey / goalKey", () => {
  it("scopes the list key to a project or to 'all' when unscoped", () => {
    expect(goalsKey()).toEqual(["goals", "all"]);
    expect(goalsKey("p1")).toEqual(["goals", "p1"]);
    expect(goalKey("g9")).toEqual(["goal", "g9"]);
  });
});

describe("goalStatusTone", () => {
  it("maps every status to its tint and falls back for draft/unknown", () => {
    expect(goalStatusTone("achieved")).toContain("green");
    expect(goalStatusTone("on_track")).toContain("blue");
    expect(goalStatusTone("at_risk")).toContain("amber");
    expect(goalStatusTone("off_track")).toContain("red");
    expect(goalStatusTone("draft")).toContain("text-muted-foreground");
    expect(goalStatusTone("other" as GoalStatus)).toContain("text-muted-foreground");
  });
});

describe("GOAL_STATUSES", () => {
  it("is the closed, ordered status set", () => {
    expect(GOAL_STATUSES).toEqual(["draft", "on_track", "at_risk", "off_track", "achieved"]);
  });
});

describe("useGoals", () => {
  it("fetches the unscoped listing with no query string", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([goal()]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGoals(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/goals");
    expect(result.current.data).toHaveLength(1);
  });

  it("appends an encoded projectId when scoped", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGoals("p 1"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/goals?projectId=p%201");
  });
});

describe("useGoal", () => {
  it("fetches a single goal when an id is supplied", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal({ id: "g7" })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGoal("g 7"), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/goals/g%207");
    expect(result.current.data?.id).toBe("g7");
  });

  it("stays disabled (no fetch) when the id is undefined", () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useGoal(undefined), { wrapper: wrapper(newClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useCreateGoal", () => {
  it("POSTs the input and invalidates the goals + goal keys on success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal({ id: "gNew" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateGoal(), { wrapper: wrapper(client) });
    result.current.mutate({ title: "T", keyResults: [] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals");
    expect((opts as RequestInit).method).toBe("POST");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["goals"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: goalKey("gNew") });
  });
});

describe("useUpdateGoal", () => {
  it("PUTs to the id-scoped endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal({ id: "g1" })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useUpdateGoal(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "g 1", input: { title: "New", keyResults: [] } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals/g%201");
    expect((opts as RequestInit).method).toBe("PUT");
  });
});

describe("useCheckInGoal", () => {
  it("POSTs to the checkin endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCheckInGoal(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "g1", input: { note: "hi", krValues: {} } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals/g1/checkin");
    expect((opts as RequestInit).method).toBe("POST");
  });
});

describe("useLinkGoal", () => {
  it("POSTs to the links endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLinkGoal(), { wrapper: wrapper(newClient()) });
    result.current.mutate({ id: "g1", input: { system: "jira", projectRef: "P", itemRef: "1" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals/g1/links");
    expect((opts as RequestInit).method).toBe("POST");
  });
});

describe("useUnlinkGoal", () => {
  it("DELETEs the encoded link key and invalidates via the returned goal id", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(goal({ id: "g1" })));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkGoal(), { wrapper: wrapper(client) });
    result.current.mutate({ id: "g1", key: "sys:a/b" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals/g1/links/sys%3Aa%2Fb");
    expect((opts as RequestInit).method).toBe("DELETE");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: goalKey("g1") });
  });

  it("only invalidates the list when the reply carries no goal (undefined id)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUnlinkGoal(), { wrapper: wrapper(client) });
    result.current.mutate({ id: "g1", key: "k" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["goals"] });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: goalKey("g1") });
  });
});

describe("useDeleteGoal", () => {
  it("DELETEs the goal and invalidates only the list (no id)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteGoal(), { wrapper: wrapper(client) });
    result.current.mutate("g 1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/goals/g%201");
    expect((opts as RequestInit).method).toBe("DELETE");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["goals"] });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server error when a mutation fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "nope" }, 403)));
    const { result } = renderHook(() => useDeleteGoal(), { wrapper: wrapper(newClient()) });
    result.current.mutate("g1");
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("nope");
  });
});
