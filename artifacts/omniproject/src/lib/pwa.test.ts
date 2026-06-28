import { describe, it, expect } from "vitest";
import { shouldRegister, isBypassed } from "./pwa";

/**
 * Service-worker policy: register only in prod where SW exists; and NEVER let the SW
 * touch API / auth / non-GET traffic, so no project data is ever cached at rest.
 */
describe("shouldRegister", () => {
  it("registers only in production with SW support", () => {
    expect(shouldRegister({ serviceWorker: true, isProd: true })).toBe(true);
    expect(shouldRegister({ serviceWorker: true, isProd: false })).toBe(false);
    expect(shouldRegister({ serviceWorker: false, isProd: true })).toBe(false);
  });
});

describe("isBypassed", () => {
  it("bypasses all API, auth and OAuth paths", () => {
    expect(isBypassed("/api/projects")).toBe(true);
    expect(isBypassed("/auth/login")).toBe(true);
    expect(isBypassed("/oauth/callback")).toBe(true);
  });
  it("bypasses every non-GET request", () => {
    expect(isBypassed("/index.html", "POST")).toBe(true);
    expect(isBypassed("/assets/app.js", "DELETE")).toBe(true);
  });
  it("allows static shell GETs to be cached", () => {
    expect(isBypassed("/assets/app-abc123.js")).toBe(false);
    expect(isBypassed("/index.html")).toBe(false);
    expect(isBypassed("/icons/app-icon.svg")).toBe(false);
  });
});
