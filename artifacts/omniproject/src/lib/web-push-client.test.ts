import { describe, it, expect, afterEach, vi } from "vitest";
import { pushSupported, notificationPermission, subscribeToPush, unsubscribeFromPush } from "./web-push-client";

/**
 * The browser Web Push client. jsdom exposes no PushManager/Notification, so the capability probe reports
 * unsupported and the subscribe/unsubscribe entry points stay inert (no network) — exactly the safe default
 * for a browser that can't do push.
 */

afterEach(() => { vi.restoreAllMocks(); });

describe("web-push-client capability probe", () => {
  it("reports unsupported when the browser lacks PushManager / Notification (jsdom)", () => {
    expect(pushSupported()).toBe(false);
    expect(notificationPermission()).toBe("unsupported");
  });

  it("subscribeToPush resolves false without touching the network when unsupported", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await subscribeToPush()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("unsubscribeFromPush is a safe no-op when unsupported", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(unsubscribeFromPush()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
