import { describe, it, expect, vi, afterEach } from "vitest";
import { shouldRegister, isBypassed, registerServiceWorker } from "./pwa";

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
  it("bypasses (fails safe) when the URL can't be parsed", () => {
    expect(isBypassed("http://[::1")).toBe(true);
  });
  it("bypasses regardless of path case (case-insensitive, no case-sensitivity gap)", () => {
    expect(isBypassed("/API/projects")).toBe(true);
    expect(isBypassed("/Auth/login")).toBe(true);
  });
  it("bypasses the exact prefix path with no trailing segment", () => {
    expect(isBypassed("/api")).toBe(true);
    expect(isBypassed("/auth")).toBe(true);
  });
});

/**
 * The actual registration: deferred to window "load" (never competing with first
 * paint), scope normalization, and swallowing a failed registration — none of the
 * tests above ever call this function.
 */
describe("registerServiceWorker", () => {
  // Capture the "load" callback via a spy rather than actually dispatching a "load"
  // event on the shared jsdom `window` — real listeners added across tests would
  // otherwise accumulate (window persists for the whole file) and re-fire on every
  // later dispatch. Invoking the captured callback directly avoids that leak.
  function stubServiceWorker(register: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, "serviceWorker", { value: { register }, configurable: true });
    return vi.spyOn(window, "addEventListener");
  }

  function fireLoad(addEventListenerSpy: ReturnType<typeof vi.spyOn>) {
    const [, onLoad] = addEventListenerSpy.mock.calls.find(([type]) => type === "load")!;
    (onLoad as () => void)();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error test-only cleanup of the stub installed above
    delete navigator.serviceWorker;
  });

  it("does nothing when shouldRegister is false (e.g. dev mode)", () => {
    const register = vi.fn();
    const addEventListenerSpy = stubServiceWorker(register);
    registerServiceWorker("/", { serviceWorker: true, isProd: false });
    expect(addEventListenerSpy).not.toHaveBeenCalledWith("load", expect.anything());
    expect(register).not.toHaveBeenCalled();
  });

  it("registers against the base path on window load, normalizing a missing trailing slash", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const addEventListenerSpy = stubServiceWorker(register);
    registerServiceWorker("/app", { serviceWorker: true, isProd: true });
    fireLoad(addEventListenerSpy);
    expect(register).toHaveBeenCalledWith("/app/sw.js", { scope: "/app/" });
  });

  it("doesn't double-normalize a base path that already ends in a slash", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const addEventListenerSpy = stubServiceWorker(register);
    registerServiceWorker("/app/", { serviceWorker: true, isProd: true });
    fireLoad(addEventListenerSpy);
    expect(register).toHaveBeenCalledWith("/app/sw.js", { scope: "/app/" });
  });

  it("swallows a registration failure instead of throwing (the app still works online)", async () => {
    const register = vi.fn().mockRejectedValue(new Error("insecure context"));
    const addEventListenerSpy = stubServiceWorker(register);
    registerServiceWorker("/", { serviceWorker: true, isProd: true });
    expect(() => fireLoad(addEventListenerSpy)).not.toThrow();
    // Let the rejected promise's .catch() settle before the test ends.
    await vi.waitFor(() => expect(register).toHaveBeenCalled());
  });
});
