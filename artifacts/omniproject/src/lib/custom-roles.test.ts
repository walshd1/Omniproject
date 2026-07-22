import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  customRolesKey,
  useCustomRoles,
  saveCustomRoles,
  type CustomRolesConfig,
  type CustomRolesState,
} from "./custom-roles";

/**
 * custom-roles.ts is the admin client seam over `/api/admin/custom-roles`: the `customRolesKey`
 * query key, the `useCustomRoles` read hook, and the `saveCustomRoles` PUT. The hook is driven
 * through a retry-disabled QueryClient with a stubbed `fetch`; the save is called directly and
 * asserted on the method/URL/body it sends and the error it surfaces.
 */

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function config(over: Partial<CustomRolesConfig> = {}): CustomRolesConfig {
  return {
    permissionSets: [{ id: "ps1", label: "Governance", description: "gov", capabilities: ["approve"] }],
    customRoles: [{ id: "cr1", label: "Auditor", baseRole: "viewer", permissionSetIds: ["ps1"], groups: ["auditors"] }],
    ...over,
  };
}

function state(): CustomRolesState {
  return { config: config(), baseRoles: ["viewer", "manager"], roles: ["viewer"], capabilities: [{ id: "approve", label: "Approve", kind: "governance" }] };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.restoreAllMocks());

describe("customRolesKey", () => {
  it("is the stable admin custom-roles query key", () => {
    expect(customRolesKey).toEqual(["admin", "custom-roles"]);
  });
});

describe("useCustomRoles", () => {
  it("fetches the config + pickers same-origin", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(state()));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCustomRoles(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/admin/custom-roles");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).credentials).toBe("same-origin");
    expect(result.current.data?.config.customRoles[0]!.label).toBe("Auditor");
  });

  it("surfaces the server error on a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "forbidden" }, 403)));
    const { result } = renderHook(() => useCustomRoles(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("forbidden");
  });
});

describe("saveCustomRoles", () => {
  it("PUTs the whole config to /api/admin/custom-roles", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ config: config() }));
    vi.stubGlobal("fetch", fetchMock);
    const cfg = config();
    const res = await saveCustomRoles(cfg);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/admin/custom-roles");
    const init = fetchMock.mock.calls.at(-1)![1] as RequestInit;
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(cfg);
    expect(res.config.customRoles[0]!.label).toBe("Auditor");
  });

  it("maps a step-up requirement to the step_up_required error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ code: "step_up_required" }, 403)));
    await expect(saveCustomRoles(config())).rejects.toThrow("step_up_required");
  });
});
