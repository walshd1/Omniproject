import { describe, it, expect, vi, afterEach } from "vitest";
import { stepUp, isStepUpRequired } from "./step-up";

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
});
