import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { connectivityState, useOnline } from "./connectivity";

/** Connectivity — the pure state resolver + the live online/offline hook. */
describe("connectivityState", () => {
  it("device-offline dominates a healthy gateway", () => {
    expect(connectivityState(false, true)).toBe("offline");
    expect(connectivityState(false, false)).toBe("offline");
  });
  it("online + healthy = connected; online + unhealthy = unreachable", () => {
    expect(connectivityState(true, true)).toBe("connected");
    expect(connectivityState(true, false)).toBe("unreachable");
  });
});

describe("useOnline", () => {
  afterEach(() => { Object.defineProperty(navigator, "onLine", { value: true, configurable: true }); });

  it("tracks the browser online/offline events", () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true); // jsdom defaults navigator.onLine true
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });
});
