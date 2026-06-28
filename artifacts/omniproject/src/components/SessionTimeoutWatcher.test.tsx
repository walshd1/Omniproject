import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { screen, act } from "@testing-library/react";
import { renderWithProviders } from "../test/utils";
import { SessionTimeoutWatcher } from "./SessionTimeoutWatcher";

/**
 * The idle watcher warns near the limit and is inert when signed out or when the
 * server disables the timeout.
 */
function seed(auth: unknown): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } });
  qc.setQueryData(["auth", "me"], auth);
  return qc;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SessionTimeoutWatcher", () => {
  it("renders nothing when signed out", () => {
    renderWithProviders(<SessionTimeoutWatcher />, { client: seed({ authenticated: false }) });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByTestId("session-timeout-warning")).not.toBeInTheDocument();
  });

  it("renders nothing when the server disables the timeout (idleMs 0)", () => {
    renderWithProviders(<SessionTimeoutWatcher />, { client: seed({ authenticated: true, sessionTimeout: { idleMs: 0, absoluteMs: 0 } }) });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByTestId("session-timeout-warning")).not.toBeInTheDocument();
  });

  it("shows the countdown warning as the idle limit approaches", () => {
    // 90s idle limit, 60s warning window ⇒ warning shows after ~31s of inactivity.
    renderWithProviders(<SessionTimeoutWatcher />, { client: seed({ authenticated: true, sessionTimeout: { idleMs: 90_000, absoluteMs: 0 } }) });
    expect(screen.queryByTestId("session-timeout-warning")).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(35_000); });
    expect(screen.getByTestId("session-timeout-warning")).toBeInTheDocument();
    expect(screen.getByText(/Signing you out/)).toBeInTheDocument();
  });
});
