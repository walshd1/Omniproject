import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formsResolvedKey,
  legacyFormsKey,
  useForms,
  useLegacyForms,
  useSaveFormDef,
  useDrainLegacyForms,
  submitForm,
  findForm,
  type FormDef,
} from "./forms";
import { settingsQueryKey } from "./settings-query";

/**
 * forms.ts is the intake-forms client seam over `/api/forms/*` + the def-store importer: the resolved/legacy
 * read hooks, the save/drain mutations, and two pure helpers (`submitForm`, `findForm`). Each hook is driven
 * through a retry-disabled QueryClient with a stubbed `fetch`, asserting method/URL/body and the query keys
 * its `onSuccess` invalidates.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function form(over: Partial<FormDef> = {}): FormDef {
  return { id: "intake", label: "Intake", fields: [{ key: "s", label: "S", type: "text", mapTo: "title" }], target: { kind: "issue" }, ...over } as FormDef;
}

afterEach(() => vi.restoreAllMocks());

describe("query keys", () => {
  it("are the stable, shared cache keys", () => {
    expect(formsResolvedKey).toEqual(["forms", "resolved"]);
    expect(legacyFormsKey).toEqual(["forms", "legacy"]);
  });
});

describe("useForms", () => {
  it("GETs the resolved endpoint and unwraps the forms array", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ forms: [form()] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useForms(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/forms/resolved");
    expect(result.current.data).toHaveLength(1);
  });

  it("falls back to [] when the envelope has no forms field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const { result } = renderHook(() => useForms(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useLegacyForms", () => {
  it("GETs the legacy endpoint and unwraps the forms array", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ forms: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useLegacyForms(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/forms");
    expect(result.current.data).toEqual([]);
  });

  it("falls back to [] when the envelope has no forms field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const { result } = renderHook(() => useLegacyForms(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useSaveFormDef", () => {
  it("POSTs the form through the importer (org storage, label name) and invalidates the resolved cache", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "org~x" }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveFormDef(), { wrapper: wrapper(client) });
    result.current.mutate(form({ label: "My form" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs");
    expect((opts as RequestInit).method).toBe("POST");
    const body = JSON.parse(String((opts as RequestInit).body));
    expect(body).toMatchObject({ kind: "form", storage: "org", name: "My form" });
    expect(body.payload.id).toBe("intake");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: formsResolvedKey });
  });

  it("names the def by the form id when the form has no label", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: "org~x" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useSaveFormDef(), { wrapper: wrapper(newClient()) });
    result.current.mutate(form({ label: undefined as unknown as string, id: "fallback-id" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(String((fetchMock.mock.calls.at(-1)![1] as RequestInit).body)).name).toBe("fallback-id");
  });

  it("surfaces the server error when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "denied" }, 403)));
    const { result } = renderHook(() => useSaveFormDef(), { wrapper: wrapper(newClient()) });
    result.current.mutate(form());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("denied");
  });
});

describe("useDrainLegacyForms", () => {
  it("PUTs an empty forms list and invalidates the legacy + settings caches", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDrainLegacyForms(), { wrapper: wrapper(client) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/forms");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ forms: [] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: legacyFormsKey });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: settingsQueryKey });
  });
});

describe("submitForm", () => {
  it("POSTs the values to the encoded per-form submit endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, issue: { id: "i1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await submitForm("my form", { a: 1 });
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/forms/my%20form/submit");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ values: { a: 1 } });
    expect(out).toEqual({ ok: true, issue: { id: "i1" } });
  });

  it("rejects with the server error when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "bad values" }, 400)));
    await expect(submitForm("f", {})).rejects.toThrow("bad values");
  });
});

describe("findForm", () => {
  it("resolves a form by id, and returns undefined for a miss", () => {
    const forms = [form({ id: "a" }), form({ id: "b" })];
    expect(findForm(forms, "b")?.id).toBe("b");
    expect(findForm(forms, "zzz")).toBeUndefined();
  });
});
