import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  roleAtLeast,
  isPmoOrAdmin,
  login,
  logout,
  samlLogin,
  oauth2Login,
  requestMagicLink,
  useAuth,
  useAuthProviders,
  type Role,
} from "./auth";

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("roleAtLeast", () => {
  it("ranks viewer < contributor < manager < admin", () => {
    expect(roleAtLeast("admin", "manager")).toBe(true);
    expect(roleAtLeast("manager", "manager")).toBe(true);
    expect(roleAtLeast("contributor", "manager")).toBe(false);
    expect(roleAtLeast("viewer", "contributor")).toBe(false);
  });

  it("treats undefined role as viewer", () => {
    expect(roleAtLeast(undefined, "viewer")).toBe(true);
    expect(roleAtLeast(undefined, "contributor")).toBe(false);
  });

  it("admin meets every BASE minimum + the admin authority", () => {
    const mins: Role[] = ["viewer", "contributor", "manager", "admin"];
    for (const m of mins) expect(roleAtLeast("admin", m)).toBe(true);
  });

  it("treats pmo and admin as orthogonal authorities (matching the gateway)", () => {
    // Both authorities confer manager-level base, so they clear the base ladder…
    for (const m of ["viewer", "contributor", "manager"] as Role[]) {
      expect(roleAtLeast("pmo", m)).toBe(true);
      expect(roleAtLeast("admin", m)).toBe(true);
    }
    // …but the authorities are independent: neither satisfies the other.
    expect(roleAtLeast("admin", "pmo")).toBe(false);
    expect(roleAtLeast("pmo", "admin")).toBe(false);
    expect(roleAtLeast("pmo", "pmo")).toBe(true);
    expect(roleAtLeast("admin", "admin")).toBe(true);
    // A plain manager holds no authority.
    expect(roleAtLeast("manager", "pmo")).toBe(false);
    expect(roleAtLeast("manager", "admin")).toBe(false);
  });
});

describe("isPmoOrAdmin", () => {
  it("holds for either orthogonal authority, not for plain base roles", () => {
    expect(isPmoOrAdmin("admin")).toBe(true);
    expect(isPmoOrAdmin("pmo")).toBe(true);
    expect(isPmoOrAdmin("manager")).toBe(false);
    expect(isPmoOrAdmin("contributor")).toBe(false);
    expect(isPmoOrAdmin("viewer")).toBe(false);
    expect(isPmoOrAdmin(undefined)).toBe(false);
  });
});

describe("login / logout (window.location)", () => {
  let originalFetch: typeof globalThis.fetch;
  let hrefValue: string;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    hrefValue = "/start";
    // Replace window.location with a settable stub.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        get pathname() {
          return "/current";
        },
        get href() {
          return hrefValue;
        },
        set href(v: string) {
          hrefValue = v;
        },
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("login redirects to the gateway with an encoded returnTo", () => {
    login("/projects/42?x=1");
    expect(hrefValue).toBe(
      "/api/auth/login?returnTo=" + encodeURIComponent("/projects/42?x=1"),
    );
  });

  it("login defaults returnTo to current pathname", () => {
    login();
    expect(hrefValue).toBe("/api/auth/login?returnTo=" + encodeURIComponent("/current"));
  });

  it("login coerces an empty returnTo to /", () => {
    login("");
    expect(hrefValue).toBe("/api/auth/login?returnTo=" + encodeURIComponent("/"));
  });

  it("login appends the provider id when one is given", () => {
    login("/projects/42", "okta");
    expect(hrefValue).toBe(
      "/api/auth/login?returnTo=" + encodeURIComponent("/projects/42") + "&provider=" + encodeURIComponent("okta"),
    );
  });

  it("logout POSTs to the gateway then redirects to /login", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await logout();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(hrefValue).toBe("/login");
  });

  it("logout still redirects when the request rejects", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network")) as unknown as typeof fetch;
    await logout();
    expect(hrefValue).toBe("/login");
  });

  it("logout wipes session-derived client data (no remanence for the next user) but keeps device prefs", async () => {
    // Session-derived data that must NOT survive logout on a shared machine.
    window.localStorage.setItem("omni:recents", JSON.stringify([{ id: "proj-secret", label: "Acme M&A" }]));
    window.sessionStorage.setItem("omniproject-portfolio-snapshots", JSON.stringify([{ scenario: "layoffs" }]));
    // A device preference that SHOULD survive (no session data; clearing it only hurts UX).
    window.localStorage.setItem("omni.locale", "fr");

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
    await logout();

    expect(window.localStorage.getItem("omni:recents")).toBeNull();
    expect(window.sessionStorage.getItem("omniproject-portfolio-snapshots")).toBeNull();
    expect(window.localStorage.getItem("omni.locale")).toBe("fr"); // preference preserved
  });

  it("samlLogin redirects to the SAML SP-initiated flow with an encoded returnTo", () => {
    samlLogin("/projects/42?x=1");
    expect(hrefValue).toBe("/api/auth/saml/login?returnTo=" + encodeURIComponent("/projects/42?x=1"));
  });

  it("samlLogin defaults returnTo to the current pathname and coerces empty to /", () => {
    samlLogin();
    expect(hrefValue).toBe("/api/auth/saml/login?returnTo=" + encodeURIComponent("/current"));
    samlLogin("");
    expect(hrefValue).toBe("/api/auth/saml/login?returnTo=" + encodeURIComponent("/"));
  });

  it("oauth2Login redirects to the generic OAuth2 flow with an encoded returnTo", () => {
    oauth2Login("/projects/42?x=1");
    expect(hrefValue).toBe("/api/auth/oauth2/login?returnTo=" + encodeURIComponent("/projects/42?x=1"));
  });

  it("oauth2Login defaults returnTo to the current pathname and coerces empty to /", () => {
    oauth2Login();
    expect(hrefValue).toBe("/api/auth/oauth2/login?returnTo=" + encodeURIComponent("/current"));
    oauth2Login("");
    expect(hrefValue).toBe("/api/auth/oauth2/login?returnTo=" + encodeURIComponent("/"));
  });
});

describe("requestMagicLink", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs the email and returnTo, resolving to the parsed body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, devLink: "/dev/magic/abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestMagicLink("ada@example.com", "/dashboard");
    expect(result).toEqual({ ok: true, devLink: "/dev/magic/abc" });
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("/api/auth/magic/request");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(init!.body))).toEqual({ email: "ada@example.com", returnTo: "/dashboard" });
  });

  it("defaults returnTo to /", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await requestMagicLink("ada@example.com");
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(JSON.parse(String(init!.body))).toEqual({ email: "ada@example.com", returnTo: "/" });
  });

  it("falls back to { ok: false } when the response body isn't valid JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestMagicLink("ada@example.com");
    expect(result).toEqual({ ok: false });
  });
});

describe("useAuth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the current session from the gateway", async () => {
    const state = { authenticated: true, mode: "demo", user: { sub: "u1" }, role: "viewer" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual(state));
  });

  it("throws (surfacing isError) when the session check fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const { result } = renderHook(() => useAuth(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useAuthProviders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the configured OIDC providers", async () => {
    const providers = [{ id: "okta", label: "Okta", kind: "oidc" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ providers }), { status: 200 })));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual(providers));
  });

  it("defaults to an empty list when the response has no providers field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("resolves to an empty list (not an error) when the request fails — demo mode has no providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { result } = renderHook(() => useAuthProviders(), { wrapper: wrapper(newClient()) });
    await waitFor(() => expect(result.current.data).toEqual([]));
    expect(result.current.isError).toBe(false);
  });
});
