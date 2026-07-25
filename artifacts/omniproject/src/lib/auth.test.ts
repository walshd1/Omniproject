import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  roleAtLeast,
  isPmoOrAdmin,
  useAuth,
  useAuthProviders,
  login,
  samlLogin,
  oauth2Login,
  requestMagicLink,
  localLogin,
  bootstrapFirstAdmin,
  clearClientSessionData,
  logout,
} from "./auth";

/**
 * The SPA's mirror of the gateway RBAC model: a LINEAR base ladder (guest < viewer < contributor < manager <
 * programmeManager) plus two ORTHOGONAL authorities (pmo, admin) that each confer programmeManager base but
 * are independent of each other. Plus the login-flow redirects and the fail-soft session-wipe on logout.
 */
vi.mock("./offline-cache", () => ({ clearOfflineCache: vi.fn(async () => {}) }));
vi.mock("./web-push-client", () => ({ unsubscribeFromPush: vi.fn(async () => {}) }));
import { clearOfflineCache } from "./offline-cache";
import { unsubscribeFromPush } from "./web-push-client";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
/** A response whose body is not valid JSON, so `.json()` rejects (exercises the `.catch(...)` arms). */
function badJsonResponse(status = 200): Response {
  return new Response("<<not json>>", { status, headers: { "Content-Type": "text/html" } });
}
function stubLocation(pathname = "/"): { href: string; pathname: string } {
  const loc = { href: "", pathname };
  Object.defineProperty(window, "location", { value: loc, writable: true, configurable: true });
  return loc;
}

/**
 * Install controllable session/local storage stubs (jsdom's `window.sessionStorage` getter can hand back a
 * fresh object per access, so a plain `spyOn` misses the call the code under test makes). Returns the mock
 * fns + a restore that puts the originals back BEFORE the global setup's afterEach reaches for localStorage.
 */
function stubStorage(over: { clear?: () => void; removeItem?: (k: string) => void } = {}) {
  const origSession = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  const origLocal = Object.getOwnPropertyDescriptor(window, "localStorage");
  const clear = vi.fn(over.clear);
  const removeItem = vi.fn(over.removeItem);
  Object.defineProperty(window, "sessionStorage", { value: { clear }, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: { clear: vi.fn(), removeItem }, configurable: true, writable: true });
  const restore = () => {
    if (origSession) Object.defineProperty(window, "sessionStorage", origSession);
    if (origLocal) Object.defineProperty(window, "localStorage", origLocal);
  };
  return { clear, removeItem, restore };
}

afterEach(() => vi.restoreAllMocks());

describe("roleAtLeast", () => {
  it("defaults a missing role to viewer", () => {
    expect(roleAtLeast(undefined, "viewer")).toBe(true);
    expect(roleAtLeast(undefined, "contributor")).toBe(false);
  });

  it("gates an AUTHORITY on that EXACT authority (orthogonal — admin ≠ pmo)", () => {
    expect(roleAtLeast("pmo", "pmo")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    expect(roleAtLeast("admin", "pmo")).toBe(false);
    expect(roleAtLeast("pmo", "admin")).toBe(false);
    expect(roleAtLeast("viewer", "admin")).toBe(false);
  });

  it("uses the base ladder for a base gate", () => {
    expect(roleAtLeast("guest", "viewer")).toBe(false); // the floor never clears viewer
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("contributor", "viewer")).toBe(true);
    expect(roleAtLeast("manager", "contributor")).toBe(true);
    expect(roleAtLeast("programmeManager", "manager")).toBe(true);
    expect(roleAtLeast("contributor", "manager")).toBe(false);
  });

  it("lets an authority clear base rungs up to programmeManager", () => {
    expect(roleAtLeast("pmo", "manager")).toBe(true);
    expect(roleAtLeast("admin", "programmeManager")).toBe(true);
    expect(roleAtLeast("pmo", "programmeManager")).toBe(true);
  });
});

describe("isPmoOrAdmin", () => {
  it("is true for either authority and false for everything else", () => {
    expect(isPmoOrAdmin("admin")).toBe(true);
    expect(isPmoOrAdmin("pmo")).toBe(true);
    expect(isPmoOrAdmin("manager")).toBe(false);
    expect(isPmoOrAdmin("guest")).toBe(false);
    expect(isPmoOrAdmin(undefined)).toBe(false);
  });
});

describe("useAuth", () => {
  it("GETs the session and returns the AuthState", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ authenticated: true, mode: "demo", user: null, role: "admin" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/me");
    expect(result.current.data!.role).toBe("admin");
  });

  it("throws with the status when the session check is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("auth check failed: 401");
  });
});

describe("useAuthProviders", () => {
  it("returns the configured providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ providers: [{ id: "g", label: "Google", kind: "oidc" }] })));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.map((p) => p.id)).toEqual(["g"]);
  });

  it("falls back to [] when the body omits `providers`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("returns [] on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("login", () => {
  it("redirects to the login endpoint with the current path when no returnTo is given", () => {
    const loc = stubLocation("/dashboard");
    login();
    expect(loc.href).toBe("/api/auth/login?returnTo=%2Fdashboard");
  });

  it("encodes an explicit returnTo and appends a provider", () => {
    const loc = stubLocation("/x");
    login("/a b", "github");
    expect(loc.href).toBe("/api/auth/login?returnTo=%2Fa%20b&provider=github");
  });

  it("falls back to / for an empty returnTo", () => {
    const loc = stubLocation("/x");
    login("");
    expect(loc.href).toBe("/api/auth/login?returnTo=%2F");
  });
});

describe("samlLogin / oauth2Login", () => {
  it("redirect into their respective flows with an encoded returnTo", () => {
    const loc = stubLocation("/p");
    samlLogin();
    expect(loc.href).toBe("/api/auth/saml/login?returnTo=%2Fp");
    oauth2Login("/q");
    expect(loc.href).toBe("/api/auth/oauth2/login?returnTo=%2Fq");
  });

  it("fall back to / for an empty returnTo", () => {
    const loc = stubLocation("/p");
    samlLogin("");
    expect(loc.href).toBe("/api/auth/saml/login?returnTo=%2F");
    oauth2Login("");
    expect(loc.href).toBe("/api/auth/oauth2/login?returnTo=%2F");
  });
});

describe("requestMagicLink", () => {
  it("POSTs the email + returnTo and returns the parsed reply", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, devLink: "http://x/magic" }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await requestMagicLink("a@b.com", "/home");
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/auth/magic/request");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ email: "a@b.com", returnTo: "/home" });
    expect(out).toEqual({ ok: true, devLink: "http://x/magic" });
  });

  it("returns { ok: false } when the reply body isn't JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => badJsonResponse()));
    expect(await requestMagicLink("a@b.com")).toEqual({ ok: false });
  });
});

describe("localLogin", () => {
  it("returns the server's returnTo on success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, returnTo: "/next" }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await localLogin("dan", "pw", "/fallback");
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/auth/local");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ userName: "dan", password: "pw", returnTo: "/fallback" });
    expect(out).toEqual({ ok: true, returnTo: "/next" });
  });

  it("falls back to the supplied returnTo when the success body omits one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    expect(await localLogin("dan", "pw", "/fallback")).toEqual({ ok: true, returnTo: "/fallback" });
  });

  it("surfaces the server error on a failed sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Bad creds" }, 401)));
    expect(await localLogin("dan", "pw")).toEqual({ ok: false, error: "Bad creds" });
  });

  it("uses a default error message when the failure body carries none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => badJsonResponse(500)));
    expect(await localLogin("dan", "pw")).toEqual({ ok: false, error: "Sign-in failed." });
  });
});

describe("bootstrapFirstAdmin", () => {
  it("POSTs the credentials and reports success", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await bootstrapFirstAdmin("root", "pw");
    const [url, opts] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe("/api/auth/local/bootstrap");
    expect(JSON.parse(String((opts as RequestInit).body))).toEqual({ userName: "root", password: "pw" });
    expect(out).toEqual({ ok: true });
  });

  it("surfaces the server error, else a default, on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "Already claimed" }, 409)));
    expect(await bootstrapFirstAdmin("root", "pw")).toEqual({ ok: false, error: "Already claimed" });
    vi.stubGlobal("fetch", vi.fn(async () => badJsonResponse(500)));
    expect(await bootstrapFirstAdmin("root", "pw")).toEqual({ ok: false, error: "Could not create the first admin." });
  });
});

describe("clearClientSessionData", () => {
  it("clears sessionStorage and removes the data-bearing localStorage keys", () => {
    const { clear, removeItem, restore } = stubStorage();
    try {
      clearClientSessionData();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(removeItem).toHaveBeenCalledWith("omni:recents");
      expect(removeItem).toHaveBeenCalledWith("omniproject-active-project");
    } finally {
      restore();
    }
  });

  it("is fail-soft when storage is blocked (throws are swallowed)", () => {
    const { restore } = stubStorage({
      clear: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    try {
      expect(() => clearClientSessionData()).not.toThrow();
    } finally {
      restore();
    }
  });
});

describe("logout", () => {
  it("wipes session data, purges caches, POSTs logout, and redirects to /login", async () => {
    const loc = stubLocation("/somewhere");
    const { clear, restore } = stubStorage();
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await logout();
      expect(clear).toHaveBeenCalled();
      expect(clearOfflineCache).toHaveBeenCalled();
      expect(unsubscribeFromPush).toHaveBeenCalled();
      const logoutCall = fetchMock.mock.calls.find((c) => String(c[0]) === "/api/auth/logout")!;
      expect((logoutCall[1] as RequestInit).method).toBe("POST");
      expect(loc.href).toBe("/login");
    } finally {
      restore();
    }
  });

  it("still redirects to /login even if the logout POST rejects", async () => {
    const loc = stubLocation("/somewhere");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await logout();
    expect(loc.href).toBe("/login");
  });
});
