import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { useIssueFieldWrite, buildFieldUpdate } from "./use-issue-field-write";
import { useToast } from "@/hooks/use-toast";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i1", projectId: "p1", title: "T", status: "todo", priority: "high", assignee: "ada", labels: [], source: "jira", version: 4, ...over } as Issue;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mutatingCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, o]) => o && /PATCH|PUT|POST/.test((o as RequestInit).method ?? ""));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_u: string, o?: RequestInit) =>
    new Response((o?.method ?? "GET") === "GET" ? "[]" : "{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("buildFieldUpdate", () => {
  it("binds expectedVersion only when a version is known", () => {
    expect(buildFieldUpdate("status", "done", 4)).toEqual({ status: "done", expectedVersion: 4 });
    expect(buildFieldUpdate("status", "done", null)).toEqual({ status: "done" });
  });
});

describe("useIssueFieldWrite", () => {
  it("writes a field through the broker with the optimistic-concurrency token", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue()]);
    const { result } = renderHook(() => useIssueFieldWrite(), { wrapper: wrapper(qc) });
    act(() => result.current.write("p1", issue(), "status", "done"));
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    const body = String((mutatingCalls().at(-1)![1] as RequestInit).body);
    expect(body).toContain("\"status\":\"done\"");
    expect(body).toContain("expectedVersion");
  });

  it("applies the change optimistically to the cache before the server responds", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue({ status: "todo" })]);
    const { result } = renderHook(() => useIssueFieldWrite(), { wrapper: wrapper(qc) });
    act(() => result.current.write("p1", issue(), "status", "done"));
    const cached = qc.getQueryData<Issue[]>(getGetProjectIssuesQueryKey("p1"))!;
    expect(cached[0]!.status).toBe("done"); // optimistic
  });

  it("offers an Undo toast for an undoable write", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue()]);
    const { result } = renderHook(() => ({ writer: useIssueFieldWrite(), toast: useToast() }), { wrapper: wrapper(qc) });
    act(() => result.current.writer.write("p1", issue(), "status", "done", { undoable: true, label: "Status updated" }));
    await waitFor(() => expect(result.current.toast.toasts.some((t) => t.title === "Saved" && !!t.action)).toBe(true));
  });

  it("does not offer Undo when the value is unchanged", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue({ status: "todo" })]);
    const { result } = renderHook(() => ({ writer: useIssueFieldWrite(), toast: useToast() }), { wrapper: wrapper(qc) });
    // Count existing "Saved" toasts first — the toast store is module-global across tests.
    const before = result.current.toast.toasts.filter((t) => t.title === "Saved").length;
    act(() => result.current.writer.write("p1", issue({ status: "todo" }), "status", "todo", { undoable: true }));
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    const after = result.current.toast.toasts.filter((t) => t.title === "Saved").length;
    expect(after).toBe(before); // no NEW undo toast for a no-op change
  });
});
