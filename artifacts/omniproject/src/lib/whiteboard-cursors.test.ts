import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveCursors } from "./whiteboard-cursors";

/**
 * Live-cursors hook. Where EventSource is unavailable (jsdom/SSR) or the feature is off it must degrade to a
 * safe no-op: no stream, no cursors, and publish() never throws or hits the network.
 */
afterEach(() => vi.restoreAllMocks());

describe("useLiveCursors", () => {
  it("is inert when disabled — no cursors, no fetch on publish", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useLiveCursors("board:org~b1", false));
    expect(result.current.live).toBe(false);
    expect(result.current.cursors).toEqual([]);
    act(() => result.current.publish(10, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is inert without EventSource even when enabled (jsdom has none)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { result } = renderHook(() => useLiveCursors("board:org~b1", true));
    // jsdom provides no EventSource, so the transport can't come up → no-op, publish stays offline.
    expect(result.current.live).toBe(false);
    act(() => result.current.publish(1, 2));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is inert with a null room", () => {
    const { result } = renderHook(() => useLiveCursors(null, true));
    expect(result.current.live).toBe(false);
    expect(result.current.cursors).toEqual([]);
  });
});
