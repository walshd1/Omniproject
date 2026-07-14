import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LazyMount } from "./LazyMount";

/**
 * LazyMount defers rendering its children until the block scrolls near the viewport
 * (IntersectionObserver), but mounts immediately where IO is unavailable (SSR / jsdom),
 * so nothing that renders the page in a test is affected.
 */

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

const OriginalIO = globalThis.IntersectionObserver;

afterEach(() => {
  globalThis.IntersectionObserver = OriginalIO;
});

describe("LazyMount", () => {
  it("mounts children immediately when IntersectionObserver is unavailable", () => {
    // @ts-expect-error simulate an environment with no IntersectionObserver
    delete globalThis.IntersectionObserver;
    render(<LazyMount><span data-testid="child">hi</span></LazyMount>);
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("holds a placeholder until the block intersects, then reveals the children", () => {
    let cb: IOCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeIO {
      constructor(callback: IOCallback) { cb = callback; }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

    render(<LazyMount><span data-testid="child">hi</span></LazyMount>);
    // Not near the viewport yet — the observer is watching but children stay unmounted.
    expect(observe).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("child")).toBeNull();

    // A non-intersecting entry does not reveal the children.
    act(() => cb!([{ isIntersecting: false }]));
    expect(screen.queryByTestId("child")).toBeNull();

    // Scrolling it into range reveals the children and tears the observer down.
    act(() => cb!([{ isIntersecting: true }]));
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it("disconnects the observer on unmount if it never intersected", () => {
    const disconnect = vi.fn();
    class FakeIO {
      constructor(_cb: IOCallback) { void _cb; }
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn();
      root = null;
      rootMargin = "";
      thresholds = [];
    }
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

    const { unmount } = render(<LazyMount><span>hi</span></LazyMount>);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
