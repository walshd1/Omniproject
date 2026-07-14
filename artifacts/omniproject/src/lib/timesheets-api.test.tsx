import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  timesheetSourcesQueryKey,
  timesheetsQueryKey,
  useTimesheetSources,
  useTimesheets,
  useTimesheetAction,
} from "./timesheets-api";

type Call = { url: string; init: RequestInit | undefined };

function installFetch(body: unknown = {}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "application/json" }),
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => installFetch());
afterEach(() => {
  vi.restoreAllMocks();
  // @ts-expect-error test-only cleanup of the directly-assigned stub
  delete globalThis.fetch;
});

describe("query keys", () => {
  it("timesheetSourcesQueryKey is a stable constant", () => {
    expect(timesheetSourcesQueryKey).toEqual(["timesheet-sources"]);
  });

  it("timesheetsQueryKey falls back to 'all' when no status", () => {
    expect(timesheetsQueryKey()).toEqual(["timesheets", "all"]);
    expect(timesheetsQueryKey(undefined)).toEqual(["timesheets", "all"]);
  });

  it("timesheetsQueryKey uses the given status", () => {
    expect(timesheetsQueryKey("submitted")).toEqual(["timesheets", "submitted"]);
  });
});

describe("useTimesheetSources", () => {
  it("fetches the sources endpoint and returns the payload", async () => {
    const calls = installFetch({ available: true, source: "self-host", selfHostAdopted: true });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetSources(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ available: true, source: "self-host", selfHostAdopted: true });
    expect(calls[0]!.url).toBe("/api/timesheets/sources");
  });
});

describe("useTimesheets", () => {
  it("requests the unfiltered list when no status is passed", async () => {
    const calls = installFetch([]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]!.url).toBe("/api/timesheets");
  });

  it("appends the status query param when a status is given", async () => {
    const calls = installFetch([]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheets("approved"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0]!.url).toBe("/api/timesheets?status=approved");
  });

  it("does not fetch when enabled=false", async () => {
    const calls = installFetch([]);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheets("draft", false), { wrapper });
    // Give react-query a tick; a disabled query stays pending and never calls fetch.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(0);
    expect(result.current.fetchStatus).toBe("idle");
  });
});

describe("useTimesheetAction", () => {
  it("posts to the action endpoint with an encoded id and includes a note", async () => {
    const calls = installFetch({ id: "sheet 1", status: "rejected" });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "sheet/1", type: "reject", note: "fix hours" });
    });
    expect(calls[0]!.url).toBe("/api/timesheets/sheet%2F1/action");
    expect(calls[0]!.init!.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ type: "reject", note: "fix hours" });
  });

  it("omits the note from the body when none is provided", async () => {
    const calls = installFetch({ id: "s1", status: "submitted" });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "s1", type: "submit" });
    });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ type: "submit" });
    expect("note" in JSON.parse(String(calls[0]!.init!.body))).toBe(false);
  });

  it("invalidates the timesheets queries on success", async () => {
    installFetch({ id: "s1", status: "approved" });
    const { qc, wrapper } = makeWrapper();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useTimesheetAction(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "s1", type: "approve" });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["timesheets"] });
  });
});
