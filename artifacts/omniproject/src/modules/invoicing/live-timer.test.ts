import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  timerKey,
  useTimer,
  useStartTimer,
  useStopTimer,
  formatElapsed,
  type TimerState,
  type TimerEntry,
} from "./live-timer";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("formatElapsed", () => {
  it("renders hours as H:MM, clamping negatives and rounding to the minute", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(1.5)).toBe("1:30");
    expect(formatElapsed(0.25)).toBe("0:15");
    expect(formatElapsed(2)).toBe("2:00");
    expect(formatElapsed(-5)).toBe("0:00");
    // 1h 59.5m rounds up to 2:00.
    expect(formatElapsed(1 + 59.5 / 60)).toBe("2:00");
  });
});

describe("useTimer", () => {
  it("fetches the caller's timer state", async () => {
    const state: TimerState = { running: true, timer: { startedAt: new Date().toISOString(), projectId: "P1" }, elapsedHours: 1 };
    const fn = stubFetch(state);
    const { result } = renderHook(() => useTimer(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(result.current.data?.running).toBe(true);
    expect(String(fn.mock.calls[0]![0])).toBe("/api/timer");
  });

  it("resolves a stopped state", async () => {
    stubFetch({ running: false } satisfies TimerState);
    const { result } = renderHook(() => useTimer(), { wrapper: wrapper(client()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.running).toBe(false);
  });
});

describe("useStartTimer", () => {
  it("POSTs the start input and writes the returned state into the cache", async () => {
    const started: TimerState = { running: true, timer: { startedAt: new Date().toISOString(), projectId: "P9", note: "n" }, elapsedHours: 0 };
    const fn = stubFetch(started);
    const qc = client();
    const { result } = renderHook(() => useStartTimer(), { wrapper: wrapper(qc) });
    result.current.mutate({ projectId: "P9", note: "n" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/timer/start");
    expect((opts as RequestInit).method).toBe("POST");
    expect(qc.getQueryData(timerKey)).toEqual(started);
  });
});

describe("useStopTimer", () => {
  it("POSTs stop and resets the cache to a stopped state", async () => {
    const entry: TimerEntry = { projectId: "P1", date: "2026-07-20", hours: 1.5 };
    const fn = stubFetch({ running: false, entry });
    const qc = client();
    qc.setQueryData(timerKey, { running: true, timer: { startedAt: "", projectId: "P1" } } satisfies TimerState);
    const { result } = renderHook(() => useStopTimer(), { wrapper: wrapper(qc) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, opts] = fn.mock.calls.at(-1)!;
    expect(url).toBe("/api/timer/stop");
    expect((opts as RequestInit).method).toBe("POST");
    expect(result.current.data?.entry).toEqual(entry);
    expect(qc.getQueryData(timerKey)).toEqual({ running: false });
  });

  it("surfaces a server error", async () => {
    stubFetch({ error: "no timer running" }, 409);
    const { result } = renderHook(() => useStopTimer(), { wrapper: wrapper(client()) });
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("no timer running");
  });
});
