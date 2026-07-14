import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFormDialog } from "./use-form-dialog";

describe("useFormDialog", () => {
  it("starts with the initial form", () => {
    const initial = { name: "", tags: ["a"] };
    const { result } = renderHook(() => useFormDialog(initial));
    expect(result.current.form).toEqual(initial);
  });

  it("updates the draft via setForm", () => {
    const { result } = renderHook(() => useFormDialog({ name: "" }));
    act(() => result.current.setForm({ name: "edited" }));
    expect(result.current.form).toEqual({ name: "edited" });
  });

  it("reset() restores the initial form after edits", () => {
    const initial = { name: "start" };
    const { result } = renderHook(() => useFormDialog(initial));
    act(() => result.current.setForm({ name: "dirty" }));
    expect(result.current.form).toEqual({ name: "dirty" });
    act(() => result.current.reset());
    expect(result.current.form).toEqual(initial);
  });

  it("close(false) resets the draft (dialog dismissed)", () => {
    const initial = { count: 0 };
    const { result } = renderHook(() => useFormDialog(initial));
    act(() => result.current.setForm({ count: 5 }));
    act(() => result.current.close(false));
    expect(result.current.form).toEqual(initial);
  });

  it("close(true) leaves the draft untouched (dialog opening/open)", () => {
    const { result } = renderHook(() => useFormDialog({ count: 0 }));
    act(() => result.current.setForm({ count: 9 }));
    act(() => result.current.close(true));
    expect(result.current.form).toEqual({ count: 9 });
  });

  it("supports functional updates through setForm", () => {
    const { result } = renderHook(() => useFormDialog(1));
    act(() => result.current.setForm((n) => n + 1));
    expect(result.current.form).toBe(2);
  });
});
