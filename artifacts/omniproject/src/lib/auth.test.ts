import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { roleAtLeast, login, logout, type Role } from "./auth";

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

  it("admin meets every minimum", () => {
    const mins: Role[] = ["viewer", "contributor", "manager", "admin"];
    for (const m of mins) expect(roleAtLeast("admin", m)).toBe(true);
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
});
