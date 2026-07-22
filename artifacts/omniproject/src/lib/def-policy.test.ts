import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { featuresQueryKey } from "./features";
import { canWriteDefScope, writableDefScopes, useDefPolicy, saveDefPolicy, defPolicyKey, type DefGate, type DefScopePolicy } from "./def-policy";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  // Enable the `defImporter` feature so the gated read hooks fetch (see useFeatures/featureEnabled).
  qc.setQueryData(featuresQueryKey({}), [{ id: "defImporter", kind: "module", label: "defImporter", description: "", enabled: true, loaded: true, needsRestart: false }]);
  return qc;
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

/**
 * Client mirror of the server def-policy (roadmap X.12): who may author a def at each scope. The server stays
 * authoritative; this only decides which targets the UI OFFERS. Includes the `programme` scope (X.13 rung).
 */
const DEFAULTS: DefScopePolicy = { user: "contributor", project: "manager", programme: "programmeManager", org: "pmoOrAdmin" };

describe("canWriteDefScope", () => {
  it("gates each rung by the caller's role", () => {
    expect(canWriteDefScope("contributor", "contributor")).toBe(true);
    expect(canWriteDefScope("contributor", "programmeManager")).toBe(false);
    expect(canWriteDefScope("programmeManager", "programmeManager")).toBe(true);
    expect(canWriteDefScope("manager", "programmeManager")).toBe(false); // a plain PM is below the rung
    expect(canWriteDefScope("pmo", "programmeManager")).toBe(true);       // authorities sit above it
    expect(canWriteDefScope("programmeManager", "pmoOrAdmin")).toBe(false);
    expect(canWriteDefScope("admin", "pmoOrAdmin")).toBe(true);
    expect(canWriteDefScope("admin", "admin")).toBe(true);
    expect(canWriteDefScope("pmo", "admin")).toBe(false); // admin gate needs the exact admin authority
  });

  it("refuses an unrecognised gate value (the switch default)", () => {
    expect(canWriteDefScope("admin", "nonsense" as unknown as DefGate)).toBe(false);
  });
});

describe("defPolicyKey", () => {
  it("is the stable cache key", () => {
    expect(defPolicyKey).toEqual(["defs", "policy"]);
  });
});

describe("useDefPolicy", () => {
  it("GETs the current per-scope write policy", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ policy: DEFAULTS, gates: ["contributor", "manager"] }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefPolicy(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/defs/policy");
    expect(result.current.data!.policy).toEqual(DEFAULTS);
  });

  it("does not retry (the GET 404s when the defImporter module is off)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "off" }, 404));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useDefPolicy(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("saveDefPolicy", () => {
  it("PUTs the patch to the policy endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ policy: DEFAULTS }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await saveDefPolicy({ org: "admin" });
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/defs/policy");
    expect((opts as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ org: "admin" });
    expect(out.policy).toEqual(DEFAULTS);
  });

  it("throws the server error when the write is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "admin only" }, 403)));
    await expect(saveDefPolicy({ org: "admin" })).rejects.toThrow("admin only");
  });
});

describe("writableDefScopes", () => {
  it("offers programme only to a programmeManager+ (and always the lower scopes they clear)", () => {
    expect(writableDefScopes("contributor", DEFAULTS)).toEqual(["user"]);
    expect(writableDefScopes("manager", DEFAULTS)).toEqual(["user", "project"]);
    expect(writableDefScopes("programmeManager", DEFAULTS)).toEqual(["user", "project", "programme"]);
    // pmo/admin clear every scope including org.
    expect(writableDefScopes("admin", DEFAULTS)).toEqual(["user", "project", "programme", "org"]);
  });

  it("falls back to sane defaults when the policy isn't loaded", () => {
    expect(writableDefScopes("programmeManager", undefined)).toContain("programme");
    expect(writableDefScopes("contributor", undefined)).toEqual(["user"]);
  });
});
