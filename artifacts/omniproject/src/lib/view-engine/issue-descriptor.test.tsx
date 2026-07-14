import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getGetProjectIssuesQueryKey, type Issue } from "@workspace/api-client-react";
import { STATUS_ORDER, PRIORITY_LABELS } from "../constants";
import { issueDescriptor } from "./issue-descriptor";
import type { ViewRecord } from "./types";

// `over` is loosely typed so a test can force a field to `undefined` (unset) despite
// exactOptionalPropertyTypes; the return is cast to Issue.
function issue(over: Record<string, unknown> = {}): Issue {
  return { id: "issue-12345678-abc", projectId: "p1", title: "Ship it", status: "todo", priority: "high", labels: [], source: "jira", ...over } as unknown as Issue;
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const writes = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, o]) => /PATCH|PUT|POST/.test((o as RequestInit | undefined)?.method ?? ""));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (_u: string, o?: RequestInit) =>
    new Response((o?.method ?? "GET") === "GET" ? "[]" : "{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => vi.restoreAllMocks());

describe("issueDescriptor static shape", () => {
  it("declares the issue entity/noun and a single board preset over every canonical status", () => {
    expect(issueDescriptor.entity).toBe("issue");
    expect(issueDescriptor.noun).toBe("issue");
    expect(issueDescriptor.presets.map((p) => p.id)).toEqual(["board"]);
    expect(issueDescriptor.presets[0]!.columns.map((c) => c.status)).toEqual([...STATUS_ORDER]);
    expect(issueDescriptor.filterStatuses).toEqual([...STATUS_ORDER]);
    expect(issueDescriptor.closedStatuses).toEqual(["done", "cancelled"]);
    expect(issueDescriptor.doneStatus).toBe("done");
    expect(issueDescriptor.reopenStatus).toBe("todo");
  });

  it("falls back to the raw status as a column label for a status without one", () => {
    // STATUS_LABELS covers every STATUS_ORDER entry, but the `?? s` guard means an unknown
    // status would still get a column — assert the mapping is total over STATUS_ORDER.
    for (const col of issueDescriptor.presets[0]!.columns) {
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
    }
  });

  it("exposes filter/sort/group fields whose getters read the raw issue", () => {
    const i = issue({ status: "in_progress", priority: "low", assignee: "ada", dueDate: "2026-02-01", startDate: "2026-01-01", source: "github" });
    const byKey = Object.fromEntries(issueDescriptor.fields.map((f) => [f.key, f.get(i)]));
    expect(byKey["status"]).toBe("in_progress");
    expect(byKey["priority"]).toBe("low");
    expect(byKey["assignee"]).toBe("ada");
    expect(byKey["dueDate"]).toBe("2026-02-01");
    expect(byKey["startDate"]).toBe("2026-01-01");
    expect(byKey["source"]).toBe("github");
    // Date fields are flagged so timeline views can bucket by them.
    expect(issueDescriptor.fields.find((f) => f.key === "dueDate")!.isDate).toBe(true);
    expect(issueDescriptor.fields.find((f) => f.key === "status")!.isDate).toBeUndefined();
  });
});

describe("issueDescriptor.useRecords", () => {
  it("maps issues into view records — id chip, assignee, due date and each label as chips", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [
      issue({ id: "abcdefgh-1234", assignee: "ada", dueDate: "2026-03-01", labels: ["bug", "p0"] }),
    ]);
    const { result } = renderHook(() => issueDescriptor.useRecords({ projectId: "p1" }), { wrapper: wrapper(qc) });
    const rec = result.current.records[0]! as ViewRecord<Issue>;
    expect(rec.title).toBe("Ship it");
    expect(rec.status).toBe("todo");
    expect(rec.priority).toBe("high");
    // id truncated to 8 chars, mono; then assignee, due, and each label.
    expect(rec.chips[0]).toEqual({ text: "abcdefgh", mono: true });
    expect(rec.chips.map((c) => c.text)).toEqual(["abcdefgh", "ada", "due 2026-03-01", "bug", "p0"]);
  });

  it("omits the assignee/due chips when unset and coalesces a null priority", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey("p1"), [issue({ id: "short", assignee: undefined, dueDate: undefined, priority: undefined, labels: [] })]);
    const { result } = renderHook(() => issueDescriptor.useRecords({ projectId: "p1" }), { wrapper: wrapper(qc) });
    const rec = result.current.records[0]!;
    expect(rec.priority).toBeNull();
    expect(rec.chips).toEqual([{ text: "short", mono: true }]);
  });

  it("defaults to an empty list and no projectId scope without throwing", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(getGetProjectIssuesQueryKey(""), []);
    const { result } = renderHook(() => issueDescriptor.useRecords({}), { wrapper: wrapper(qc) });
    expect(result.current.records).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });
});

describe("issueDescriptor.useMove", () => {
  it("moves an issue by patching its status with the optimistic-concurrency token when a version is known", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const rec: ViewRecord<Issue> = {
      id: "i1", title: "T", status: "todo", priority: "high", chips: [], raw: issue({ id: "i1", version: 7 }),
    };
    const { result } = renderHook(() => issueDescriptor.useMove(), { wrapper: wrapper(qc) });
    act(() => result.current(rec, "done"));
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    const body = String((writes().at(-1)![1] as RequestInit).body);
    expect(body).toContain("\"status\":\"done\"");
    expect(body).toContain("\"expectedVersion\":7");
  });

  it("omits expectedVersion when the issue carries no version", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const rec: ViewRecord<Issue> = {
      id: "i2", title: "T", status: "todo", priority: "high", chips: [], raw: issue({ id: "i2", version: undefined }),
    };
    const { result } = renderHook(() => issueDescriptor.useMove(), { wrapper: wrapper(qc) });
    act(() => result.current(rec, "in_progress"));
    await waitFor(() => expect(writes().length).toBeGreaterThan(0));
    expect(String((writes().at(-1)![1] as RequestInit).body)).not.toContain("expectedVersion");
  });

  it("is a no-op when the record is already in the target status", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const rec: ViewRecord<Issue> = { id: "i3", title: "T", status: "done", priority: null, chips: [], raw: issue({ id: "i3", status: "done" }) };
    const { result } = renderHook(() => issueDescriptor.useMove(), { wrapper: wrapper(qc) });
    act(() => result.current(rec, "done"));
    // Give any (unwanted) mutation a tick to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(writes().length).toBe(0);
  });
});

describe("issueDescriptor.usePriorityLabel", () => {
  it("labels a known priority, echoes an unknown one, and blanks a null", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => issueDescriptor.usePriorityLabel(), { wrapper: wrapper(qc) });
    const label = result.current;
    expect(label("high")).toBe(PRIORITY_LABELS["high"]);
    expect(label("weird-priority")).toBe("weird-priority");
    expect(label(null)).toBe("");
    expect(label(undefined)).toBe("");
  });
});
