import { describe, it, expect, vi, afterEach } from "vitest";
import { stepUp, isStepUpRequired, withStepUp } from "./step-up";

/**
 * Client step-up: demo confirms in place (true); OIDC returns a redirect (navigates,
 * false); the 403 + code is recognised so callers can retry.
 */
afterEach(() => vi.unstubAllGlobals());

describe("stepUp", () => {
  it("resolves true when the gateway confirms in place (demo)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))));
    expect(await stepUp("/settings")).toBe(true);
  });

  it("navigates to the IdP and resolves false on a 409 redirect (OIDC)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: "/api/auth/step-up?returnTo=%2F" }), { status: 409 }))));
    const loc = { href: "" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    expect(await stepUp("/")).toBe(false);
    expect(loc.href).toContain("/api/auth/step-up");
  });

  it("does NOT navigate to a cross-origin / non-same-origin step-up url (open-redirect guard)", async () => {
    for (const url of ["//evil.com/x", "https://evil.com/x", "javascript:alert(1)"]) {
      vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url }), { status: 409 }))));
      const loc = { href: "unchanged", origin: "https://app.local" };
      Object.defineProperty(window, "location", { value: loc, writable: true });
      expect(await stepUp("/")).toBe(false);
      expect(loc.href).toBe("unchanged");
    }
  });

  it("navigates to an ABSOLUTE same-origin step-up url (URL-parse allow arm)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: "https://app.local/api/auth/step-up" }), { status: 409 }))));
    const loc = { href: "https://app.local/current", origin: "https://app.local" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    expect(await stepUp("/")).toBe(false);
    expect(loc.href).toBe("https://app.local/api/auth/step-up");
  });

  it("does NOT navigate when the redirect url can't be parsed (URL constructor throws → catch)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ url: "http://[" }), { status: 409 }))));
    const loc = { href: "unchanged", origin: "https://app.local" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    expect(await stepUp("/")).toBe(false);
    expect(loc.href).toBe("unchanged");
  });

  it("resolves false without navigating on a 409 that carries no redirect url", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 409 }))));
    const loc = { href: "unchanged" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    expect(await stepUp("/")).toBe(false);
    expect(loc.href).toBe("unchanged");
  });

  it("resolves false on a 409 whose body is not valid JSON (json().catch arm)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("<html>not json</html>", { status: 409 }))));
    const loc = { href: "unchanged" };
    Object.defineProperty(window, "location", { value: loc, writable: true });
    expect(await stepUp("/")).toBe(false);
    expect(loc.href).toBe("unchanged");
  });

  it("resolves false on other error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
    expect(await stepUp("/settings")).toBe(false);
  });

  it("defaults returnTo to the current path and posts it", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(window, "location", { value: { pathname: "/reports", href: "" }, writable: true });
    expect(await stepUp()).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ returnTo: "/reports" });
  });

  it("defaults returnTo to \"/\" in a non-browser context (no window)", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    // Drive the else side of the default-param `typeof window !== "undefined"` guard.
    vi.stubGlobal("window", undefined);
    expect(await stepUp()).toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ returnTo: "/" });
  });
});

describe("withStepUp", () => {
  it("runs fn and returns its result when the step-up succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    Object.defineProperty(window, "location", { value: { pathname: "/settings", href: "" }, writable: true });
    const fn = vi.fn(() => Promise.resolve("saved"));
    expect(await withStepUp(fn)).toBe("saved");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns null and never runs fn when the step-up is declined", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 500 }))));
    Object.defineProperty(window, "location", { value: { pathname: "/settings", href: "" }, writable: true });
    const fn = vi.fn(() => Promise.resolve("saved"));
    expect(await withStepUp(fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("returns null when fn throws after a successful step-up", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    Object.defineProperty(window, "location", { value: { pathname: "/settings", href: "" }, writable: true });
    const fn = vi.fn(() => Promise.reject(new Error("boom")));
    expect(await withStepUp(fn)).toBeNull();
    expect(fn).toHaveBeenCalledOnce();
  });

  it("returns null (generic-message arm) when fn throws a non-Error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    Object.defineProperty(window, "location", { value: { pathname: "/settings", href: "" }, writable: true });
    const fn = vi.fn(() => Promise.reject("just a string")); // eslint-disable-line prefer-promise-reject-errors
    expect(await withStepUp(fn)).toBeNull();
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("isStepUpRequired", () => {
  it("detects the step-up signal", async () => {
    const res = new Response(JSON.stringify({ code: "step_up_required" }), { status: 403 });
    expect(await isStepUpRequired(res)).toBe(true);
  });
  it("ignores other 403s and non-403s", async () => {
    expect(await isStepUpRequired(new Response("{}", { status: 403 }))).toBe(false);
    expect(await isStepUpRequired(new Response("{}", { status: 200 }))).toBe(false);
  });

  it("returns false when a 403 body isn't valid JSON", async () => {
    expect(await isStepUpRequired(new Response("<html>not json</html>", { status: 403 }))).toBe(false);
  });
});
