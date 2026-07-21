import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { featuresQueryKey } from "./features";
import {
  proofRoomId, proofsKey, proofKey, isProofDecisionHeld,
  useProofs, useProof, useCreateProof, useSaveProof, useDecideProof, useDeleteProof,
  type Proof, type ProofInput,
} from "./proofs";

/** Proofing client helpers + hooks — stable query keys, the shared-surface room convention, and the
 *  read/write hooks (method / URL / body, the `enabled` gate, project scoping, and invalidations). */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function freshClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // Enable the `proofing` feature so the gated read hooks fetch (see useFeatures/featureEnabled).
  qc.setQueryData(featuresQueryKey({}), [{ id: "proofing", kind: "module", label: "proofing", description: "", enabled: true, loaded: true, needsRestart: false }]);
  return qc;
}
function stubFetch(body: unknown = {}, status = 200) {
  const fn = vi.fn(async () => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function lastCall(fn: ReturnType<typeof vi.fn>) {
  const [url, opts] = fn.mock.calls.at(-1)! as [string, RequestInit | undefined];
  return { url, method: opts?.method, body: opts?.body ? JSON.parse(String(opts.body)) : undefined };
}
const input = (over: Partial<ProofInput> = {}): ProofInput => ({
  name: "P", deliverable: { kind: "image", url: "u" }, annotations: [], ...over,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("proofs lib helpers", () => {
  it("builds the proof review room id (general + per-annotation)", () => {
    expect(proofRoomId("user~abc")).toBe("proof:user~abc");
    expect(proofRoomId("user~abc", "a1")).toBe("proof:user~abc#a1");
  });

  it("builds stable query keys (scoped + per-proof)", () => {
    expect(proofsKey()).toEqual(["proofs", "all"]);
    expect(proofsKey("p1")).toEqual(["proofs", "p1"]);
    expect(proofKey("org~1")).toEqual(["proof", "org~1"]);
  });

  it("distinguishes a held (sign-off pending) decision response from an applied proof", () => {
    expect(isProofDecisionHeld({ pending: { proposalId: "x", action: "proof.decision" } })).toBe(true);
    const applied = { id: "user~1", name: "P", version: 1, decision: "approved", updatedAt: "" } as unknown as Proof;
    expect(isProofDecisionHeld(applied)).toBe(false);
  });
});

describe("proofs read hooks", () => {
  it("useProofs GETs the unscoped list", async () => {
    const fn = stubFetch([{ id: "p1" }]);
    const { result } = renderHook(() => useProofs(), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/proofs");
  });

  it("useProofs scopes the list to a project via the query string", async () => {
    const fn = stubFetch([]);
    const { result } = renderHook(() => useProofs("p x"), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastCall(fn).url).toBe("/api/proofs?projectId=p%20x");
  });

  it("useProof GETs one proof (encoding the id) when enabled", async () => {
    const fn = stubFetch({ id: "a/b" });
    const { result } = renderHook(() => useProof("a/b"), { wrapper: wrapper(freshClient()) });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(lastCall(fn).url).toBe("/api/proofs/a%2Fb");
  });

  it("useProof is disabled with no id", () => {
    const fn = stubFetch({});
    const { result } = renderHook(() => useProof(undefined), { wrapper: wrapper(freshClient()) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("proofs mutations", () => {
  it("useCreateProof POSTs the input and invalidates the proofs list", async () => {
    const fn = stubFetch({ id: "p1" });
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateProof(), { wrapper: wrapper(client) });
    result.current.mutate(input({ name: "New" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/proofs");
    expect(c.method).toBe("POST");
    expect(c.body).toMatchObject({ name: "New" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["proofs"] });
  });

  it("useSaveProof PUTs the input and invalidates both the proof and the list", async () => {
    const fn = stubFetch({ id: "p1" });
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSaveProof("p/1"), { wrapper: wrapper(client) });
    result.current.mutate(input());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/proofs/p%2F1");
    expect(c.method).toBe("PUT");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proofKey("p/1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["proofs"] });
  });

  it("useDecideProof POSTs the decision and invalidates both", async () => {
    const fn = stubFetch({ id: "p1", decision: "approved" });
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDecideProof("p1"), { wrapper: wrapper(client) });
    result.current.mutate("approved");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/proofs/p1/decision");
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ decision: "approved" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: proofKey("p1") });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["proofs"] });
  });

  it("useDeleteProof DELETEs the proof (bodyless) and invalidates the list", async () => {
    const fn = stubFetch({}, 204);
    const client = freshClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useDeleteProof(), { wrapper: wrapper(client) });
    result.current.mutate("p1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const c = lastCall(fn);
    expect(c.url).toBe("/api/proofs/p1");
    expect(c.method).toBe("DELETE");
    expect(c.body).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["proofs"] });
  });

  it("surfaces the server error when a mutation fails", async () => {
    stubFetch({ error: "nope" }, 500);
    const { result } = renderHook(() => useCreateProof(), { wrapper: wrapper(freshClient()) });
    result.current.mutate(input());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
