import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installCsrf, readCookie } from "./csrf";

/**
 * Client CSRF: attach X-CSRF-Token (from the omni_csrf cookie) to same-origin mutations.
 */
describe("installCsrf", () => {
  let original: typeof window.fetch;
  beforeEach(() => {
    original = vi.fn((_i: RequestInfo | URL, init?: RequestInit) => Promise.resolve(new Response("ok", { headers: new Headers(init?.headers) }))) as typeof window.fetch;
    window.fetch = original;
    (window as { __omniCsrf?: boolean }).__omniCsrf = false;
    document.cookie = "omni_csrf=tok123";
  });
  afterEach(() => { (window as { __omniCsrf?: boolean }).__omniCsrf = false; });

  it("reads a cookie value", () => {
    expect(readCookie("omni_csrf")).toBe("tok123");
    expect(readCookie("missing")).toBeNull();
  });

  it("adds the token header to a same-origin POST", async () => {
    installCsrf();
    await window.fetch("/api/issues", { method: "POST" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("tok123");
  });

  it("does NOT add the header to a GET", async () => {
    installCsrf();
    await window.fetch("/api/issues", { method: "GET" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get("X-CSRF-Token") : null).toBeNull();
  });

  it("does NOT add the header to a cross-origin POST", async () => {
    installCsrf();
    await window.fetch("https://evil.example/x", { method: "POST" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get("X-CSRF-Token") : null).toBeNull();
  });

  it("does NOT add the header to a protocol-relative (cross-origin) POST", async () => {
    installCsrf();
    await window.fetch("//evil.example/x", { method: "POST" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get("X-CSRF-Token") : null).toBeNull();
  });

  it("adds the header to an absolute same-origin POST", async () => {
    installCsrf();
    await window.fetch(`${window.location.origin}/api/issues`, { method: "PUT" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("tok123");
  });

  it("treats a malformed URL as cross-origin and skips the header", async () => {
    installCsrf();
    await window.fetch("http://[bad", { method: "POST" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get("X-CSRF-Token") : null).toBeNull();
  });

  it("derives method/url from a Request instance", async () => {
    installCsrf();
    await window.fetch(new Request(`${window.location.origin}/api/issues`, { method: "DELETE" }));
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("tok123");
  });

  it("does not overwrite a header the caller already set", async () => {
    installCsrf();
    await window.fetch("/api/issues", { method: "POST", headers: { "X-CSRF-Token": "explicit" } });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-CSRF-Token")).toBe("explicit");
  });

  it("passes the request through untouched when there is no CSRF cookie", async () => {
    document.cookie = "omni_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    installCsrf();
    await window.fetch("/api/issues", { method: "POST" });
    const init = (original as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit | undefined;
    expect(init?.headers ? new Headers(init.headers).get("X-CSRF-Token") : null).toBeNull();
    document.cookie = "omni_csrf=tok123";
  });

  it("is idempotent: a second install does not re-wrap fetch", () => {
    installCsrf();
    const wrapped = window.fetch;
    installCsrf(); // __omniCsrf already set ⇒ early return
    expect(window.fetch).toBe(wrapped);
  });

  it("readCookie regex-escapes the name so metacharacters can't widen the match", () => {
    document.cookie = "a.b=plain";
    expect(readCookie("a.b")).toBe("plain");
    expect(readCookie("axb")).toBeNull(); // '.' must be literal, not a wildcard
  });
});
