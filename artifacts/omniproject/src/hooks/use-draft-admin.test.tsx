import { describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDraftAdmin } from "./use-draft-admin";

/**
 * useDraftAdmin seeds a mutable draft from the server copy via a `toDraft` transform that doubles as the
 * clone step. Most callers pass the native global `structuredClone` straight in — so the hook must invoke
 * it as a PLAIN call, never as a member of an internal ref (`ref.current(server)`), or the global's `this`
 * would be the ref object and Chromium throws "TypeError: Illegal invocation", crashing the panel (the
 * RACI screen's register panel did exactly this). jsdom/Node's structuredClone is lenient about `this`, so
 * the guard below asserts the CALL FORM directly: the seeding transform is invoked with `this === undefined`
 * (a plain call in strict ESM), never bound to the ref object.
 */
describe("useDraftAdmin", () => {
  it("invokes the seeding transform as a plain call, not a ref member (no Illegal-invocation this-binding)", async () => {
    const server = [{ id: "a", task: "T" }];
    const seenThis: unknown[] = [];
    function cloner(this: unknown, s: typeof server): typeof server {
      seenThis.push(this); // a plain call → undefined; a `ref.current(s)` member call → the ref object
      return structuredClone(s);
    }
    const { result } = renderHook(() => useDraftAdmin<typeof server, typeof server>(server, cloner));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    expect(seenThis.length).toBeGreaterThan(0);
    expect(seenThis.every((t) => t === undefined)).toBe(true); // never bound to the internal ref
  });

  it("seeds a real clone of the server (native structuredClone) without throwing", async () => {
    const server = [{ id: "a", task: "T", role: "R" }];
    const { result } = renderHook(() => useDraftAdmin<typeof server, typeof server>(server, structuredClone));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    expect(result.current.draft).toEqual(server);
    expect(result.current.draft).not.toBe(server); // a real clone — mutating the draft can't touch the server
    expect(result.current.dirty).toBe(false);
  });

  it("seeds from an empty array too (the config-def-backed / absent-collection case)", async () => {
    const server: unknown[] = [];
    const { result } = renderHook(() => useDraftAdmin<unknown[], unknown[]>(server, structuredClone));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    expect(result.current.draft).toEqual([]);
  });

  it("reset re-clones from the server without throwing", async () => {
    const server = [{ id: "x", v: 1 }];
    const { result } = renderHook(() => useDraftAdmin<typeof server, typeof server>(server, structuredClone));
    await waitFor(() => expect(result.current.draft).not.toBeNull());
    act(() => result.current.setDraft([{ id: "x", v: 2 }]));
    expect(result.current.dirty).toBe(true);
    act(() => result.current.reset());
    expect(result.current.draft).toEqual(server);
    expect(result.current.dirty).toBe(false);
  });
});
