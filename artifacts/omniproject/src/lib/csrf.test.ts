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
});
