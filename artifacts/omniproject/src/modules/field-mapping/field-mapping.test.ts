import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useLiveSuperset,
  useResolvedMapping,
  refFromSuperset,
  type SupersetField,
  type ResolvedMapping,
} from "./field-mapping";

/**
 * Field-mapping client seam: the live-superset + resolved-mapping query hooks (their keys, URLs and
 * the `select`/`enabled` shaping) plus the pure `refFromSuperset` triple builder. Hooks are driven
 * through renderHook + a retry-disabled QueryClient with `fetch` stubbed, matching whiteboard.test.ts.
 */
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const mockFetch = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

function sfield(over: Partial<SupersetField> = {}): SupersetField {
  return {
    id: "f1",
    canonicalKey: "summary",
    label: "Summary",
    broker: "atlassian",
    system: "jira",
    nativeField: "fields.summary",
    type: "string",
    canonical: true,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("refFromSuperset", () => {
  it("builds the stored triple from a picked superset entry", () => {
    const ref = refFromSuperset(
      sfield({ broker: "atlassian", system: "jira", nativeField: "fields.summary", canonicalKey: "summary" }),
    );
    expect(ref).toEqual({ broker: "atlassian", backend: "jira", field: "fields.summary", superset: "summary" });
  });
});

describe("useLiveSuperset", () => {
  it("GETs /api/fields/superset and selects out the fields array", async () => {
    const fields = [sfield(), sfield({ id: "f2", label: "Priority", nativeField: "fields.priority" })];
    const f = mockFetch({ fields });
    const { result } = renderHook(() => useLiveSuperset(), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // select unwraps { fields } → the bare array.
    expect(result.current.data).toEqual(fields);
    expect(f.mock.calls.some(([u]) => String(u) === "/api/fields/superset")).toBe(true);
  });
});

describe("useResolvedMapping", () => {
  const resolved: ResolvedMapping = {
    id: "issue",
    fields: { Title: { field: "fields.summary", superset: "summary", backend: "jira" } },
    homeless: [],
    validation: [],
  };

  it("is disabled (no fetch) without a projectId", async () => {
    const f = mockFetch(resolved);
    const { result } = renderHook(() => useResolvedMapping(undefined, "issue"), { wrapper: wrapper(qc()) });
    // enabled === false → the query never fires.
    expect(result.current.fetchStatus).toBe("idle");
    expect(f).not.toHaveBeenCalled();
  });

  it("is disabled without a slot", async () => {
    const f = mockFetch(resolved);
    const { result } = renderHook(() => useResolvedMapping("proj-1", ""), { wrapper: wrapper(qc()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(f).not.toHaveBeenCalled();
  });

  it("GETs the project-scoped mapping URL with encoded segments", async () => {
    const f = mockFetch(resolved);
    const { result } = renderHook(() => useResolvedMapping("proj/1", "iss ue"), { wrapper: wrapper(qc()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(resolved);
    expect(
      f.mock.calls.some(([u]) => String(u) === "/api/projects/proj%2F1/mapping/iss%20ue"),
    ).toBe(true);
  });
});
