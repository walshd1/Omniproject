import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { usePushNotifications } from "./use-push";
import { useFeatures, featureEnabled } from "./features";
import { pushSupported, notificationPermission, subscribeToPush, unsubscribeFromPush } from "./web-push-client";

/**
 * React wiring for browser Web Push. `./features` and `./web-push-client` are mocked so we can drive
 * every branch of the state machine (unsupported / module-off / on / off / denied) and the toggle paths
 * without a real service worker. `readState` reaches for `navigator.serviceWorker.ready` directly, so a
 * fake service-worker registration is stubbed where the state resolves to on/off.
 */

vi.mock("./features", () => ({ useFeatures: vi.fn(), featureEnabled: vi.fn() }));
vi.mock("./web-push-client", () => ({
  pushSupported: vi.fn(),
  notificationPermission: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));

const useFeaturesMock = vi.mocked(useFeatures);
const featureEnabledMock = vi.mocked(featureEnabled);
const pushSupportedMock = vi.mocked(pushSupported);
const notificationPermissionMock = vi.mocked(notificationPermission);
const subscribeToPushMock = vi.mocked(subscribeToPush);
const unsubscribeFromPushMock = vi.mocked(unsubscribeFromPush);

/** Install a fake service-worker registration whose PushManager returns `sub` (or a rejecting ready). */
function stubServiceWorker(sub: unknown, opts: { rejectReady?: boolean } = {}): void {
  const ready = opts.rejectReady
    ? Promise.reject(new Error("no sw"))
    : Promise.resolve({ pushManager: { getSubscription: vi.fn(() => Promise.resolve(sub)) } });
  vi.stubGlobal("navigator", { serviceWorker: { ready } });
}

beforeEach(() => {
  useFeaturesMock.mockReturnValue({ data: [] } as unknown as ReturnType<typeof useFeatures>);
  featureEnabledMock.mockReturnValue(true);
  pushSupportedMock.mockReturnValue(true);
  notificationPermissionMock.mockReturnValue("granted");
  subscribeToPushMock.mockResolvedValue(true);
  unsubscribeFromPushMock.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("usePushNotifications — availability", () => {
  it("is unavailable and reports unsupported when the browser can't do push", async () => {
    pushSupportedMock.mockReturnValue(false);
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.available).toBe(false);
    expect(result.current.state).toBe("unsupported");
    // toggle is a safe no-op — no subscribe attempt.
    act(() => result.current.toggle(true));
  });

  it("is unavailable when the module is off, even if the browser supports push", async () => {
    featureEnabledMock.mockReturnValue(false);
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.available).toBe(false);
    // supported → initial state is "off", and the effect early-returns (module off), so it stays off.
    expect(result.current.state).toBe("off");
  });
});

describe("usePushNotifications — readState", () => {
  it("resolves to 'on' when a subscription already exists", async () => {
    stubServiceWorker({ endpoint: "x" });
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.available).toBe(true);
    await waitFor(() => expect(result.current.state).toBe("on"));
  });

  it("resolves to 'off' when there is no subscription", async () => {
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("resolves to 'denied' when notifications are blocked (no service-worker access)", async () => {
    notificationPermissionMock.mockReturnValue("denied");
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("resolves to 'unsupported' when the permission probe reports unsupported", async () => {
    notificationPermissionMock.mockReturnValue("unsupported");
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("unsupported"));
  });

  it("falls back to 'off' when serviceWorker.ready rejects", async () => {
    stubServiceWorker(null, { rejectReady: true });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
  });
});

describe("usePushNotifications — toggle", () => {
  it("turning on subscribes and moves to 'on'", async () => {
    stubServiceWorker(null); // starts off
    subscribeToPushMock.mockResolvedValue(true);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
    act(() => result.current.toggle(true));
    await waitFor(() => expect(result.current.state).toBe("on"));
    expect(subscribeToPushMock).toHaveBeenCalled();
  });

  it("turning on but failing with a denied permission moves to 'denied'", async () => {
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
    subscribeToPushMock.mockResolvedValue(false);
    notificationPermissionMock.mockReturnValue("denied");
    act(() => result.current.toggle(true));
    await waitFor(() => expect(result.current.state).toBe("denied"));
  });

  it("turning on but failing without a denial moves back to 'off'", async () => {
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
    subscribeToPushMock.mockResolvedValue(false);
    notificationPermissionMock.mockReturnValue("default");
    act(() => result.current.toggle(true));
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("recovers to 'off' when subscribeToPush rejects (caught)", async () => {
    stubServiceWorker(null);
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
    subscribeToPushMock.mockRejectedValue(new Error("boom"));
    notificationPermissionMock.mockReturnValue("granted");
    act(() => result.current.toggle(true));
    await waitFor(() => expect(result.current.state).toBe("off"));
  });

  it("turning off unsubscribes and moves to 'off'", async () => {
    stubServiceWorker({ endpoint: "x" }); // starts on
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("on"));
    act(() => result.current.toggle(false));
    await waitFor(() => expect(result.current.state).toBe("off"));
    expect(unsubscribeFromPushMock).toHaveBeenCalled();
  });

  it("ignores a second toggle while a toggle is in flight (busy guard)", async () => {
    stubServiceWorker(null);
    let resolveSub!: (v: boolean) => void;
    subscribeToPushMock.mockReturnValue(new Promise<boolean>((r) => { resolveSub = r; }));
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.state).toBe("off"));
    act(() => {
      result.current.toggle(true);
      result.current.toggle(true); // second call sees prev === "busy" and is a no-op
    });
    expect(result.current.state).toBe("busy");
    await act(async () => { resolveSub(true); });
    await waitFor(() => expect(result.current.state).toBe("on"));
  });
});
