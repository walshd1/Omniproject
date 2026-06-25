import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, toast, reducer } from "./use-toast";

/**
 * The toast store is a module-level singleton, so we clear it before each test
 * by removing every toast (REMOVE_TOAST with no id wipes the list) via the
 * public dismiss + fake timers, to keep cases independent.
 */
beforeEach(() => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useToast());
  act(() => {
    result.current.dismiss();
  });
  // Flush the 1,000,000ms remove-delay so the list empties.
  act(() => {
    vi.advanceTimersByTime(1_000_001);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reducer (pure)", () => {
  const base = { toasts: [] };

  it("ADD_TOAST prepends and respects the limit of 1", () => {
    const s1 = reducer(base, { type: "ADD_TOAST", toast: { id: "1", open: true } });
    const s2 = reducer(s1, { type: "ADD_TOAST", toast: { id: "2", open: true } });
    expect(s2.toasts).toHaveLength(1);
    expect(s2.toasts[0].id).toBe("2");
  });

  it("UPDATE_TOAST merges by id", () => {
    const s1 = reducer(base, { type: "ADD_TOAST", toast: { id: "1", open: true } });
    const s2 = reducer(s1, { type: "UPDATE_TOAST", toast: { id: "1", title: "hi" } });
    expect(s2.toasts[0].title).toBe("hi");
  });

  it("DISMISS_TOAST sets open=false for the target", () => {
    const s1 = reducer(base, { type: "ADD_TOAST", toast: { id: "1", open: true } });
    const s2 = reducer(s1, { type: "DISMISS_TOAST", toastId: "1" });
    expect(s2.toasts[0].open).toBe(false);
  });

  it("DISMISS_TOAST without id closes all", () => {
    const s1 = reducer(base, { type: "ADD_TOAST", toast: { id: "1", open: true } });
    const s2 = reducer(s1, { type: "DISMISS_TOAST" });
    expect(s2.toasts.every((t) => t.open === false)).toBe(true);
  });

  it("REMOVE_TOAST by id removes only that toast", () => {
    const s1 = { toasts: [{ id: "1", open: true }, { id: "2", open: true }] };
    const s2 = reducer(s1, { type: "REMOVE_TOAST", toastId: "1" });
    expect(s2.toasts.map((t) => t.id)).toEqual(["2"]);
  });

  it("REMOVE_TOAST without id clears everything", () => {
    const s1 = { toasts: [{ id: "1", open: true }] };
    const s2 = reducer(s1, { type: "REMOVE_TOAST" });
    expect(s2.toasts).toEqual([]);
  });
});

describe("toast() / useToast()", () => {
  it("adds a toast and exposes it through the hook", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "Hello" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Hello");
    expect(result.current.toasts[0].open).toBe(true);
  });

  it("enforces the limit of 1 (newest wins)", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "first" });
      toast({ title: "second" });
    });
    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("second");
  });

  it("update() mutates the existing toast in place", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "before" });
    });
    act(() => {
      handle!.update({ id: handle!.id, title: "after" });
    });
    expect(result.current.toasts[0].title).toBe("after");
  });

  it("dismiss() closes the toast (open=false) before removal", () => {
    const { result } = renderHook(() => useToast());
    let handle: ReturnType<typeof toast>;
    act(() => {
      handle = toast({ title: "x" });
    });
    act(() => {
      handle!.dismiss();
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("hook-level dismiss() closes all toasts", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "x" });
    });
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("onOpenChange(false) dismisses the toast", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "x" });
    });
    act(() => {
      result.current.toasts[0].onOpenChange?.(false);
    });
    expect(result.current.toasts[0].open).toBe(false);
  });

  it("a dismissed toast is removed after the remove delay", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      toast({ title: "x" });
    });
    act(() => {
      result.current.dismiss();
    });
    act(() => {
      vi.advanceTimersByTime(1_000_001);
    });
    expect(result.current.toasts).toHaveLength(0);
  });
});
