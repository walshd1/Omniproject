import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { useIssueFieldWrite } from "./use-issue-field-write";
import { useUndoRedo } from "./use-undo-redo";
import { useEditHistory } from "./edit-history";

function issue(over: Partial<Issue> = {}): Issue {
  return { id: "i1", projectId: "p1", title: "T", status: "todo", priority: "high", assignee: "ada", labels: [], source: "jira", version: 4, ...over } as Issue;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mutatingCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, o]) => o && /PATCH|PUT|POST/.test((o as RequestInit).method ?? ""));

beforeEach(() => {
  useEditHistory.setState({ past: [], future: [] });
  vi.stubGlobal("fetch", vi.fn(async (_u: string, o?: RequestInit) =>
    new Response((o?.method ?? "GET") === "GET" ? "[]" : "{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("useUndoRedo", () => {
  it("records a write and undoes it with the inverse value, then redoes it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue({ status: "todo" })]);
    const { result } = renderHook(() => ({ writer: useIssueFieldWrite(), ur: useUndoRedo() }), { wrapper: wrapper(qc) });

    act(() => result.current.writer.write("p1", issue({ status: "todo" }), "status", "done"));
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(0));
    expect(result.current.ur.canUndo).toBe(true);

    // Undo → inverse write restoring "todo".
    let before = mutatingCalls().length;
    act(() => result.current.ur.undo());
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(before));
    expect(String((mutatingCalls().at(-1)![1] as RequestInit).body)).toContain("\"status\":\"todo\"");
    expect(result.current.ur.canRedo).toBe(true);

    // Redo → re-apply "done".
    before = mutatingCalls().length;
    act(() => result.current.ur.redo());
    await waitFor(() => expect(mutatingCalls().length).toBeGreaterThan(before));
    expect(String((mutatingCalls().at(-1)![1] as RequestInit).body)).toContain("\"status\":\"done\"");
  });

  it("undo is a no-op when the field already holds the target value", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue({ status: "todo" })]);
    const { result } = renderHook(() => useUndoRedo(), { wrapper: wrapper(qc) });
    // Seed a history entry whose "from" already equals the cached value → applying it should write nothing.
    act(() => useEditHistory.getState().record({ projectId: "p1", issueId: "i1", field: "status", from: "todo", to: "done", label: "Status" }));
    act(() => result.current.undo());
    expect(mutatingCalls().length).toBe(0);
  });
});
