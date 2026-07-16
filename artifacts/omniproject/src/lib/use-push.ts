import { useCallback, useEffect, useState } from "react";
import { useFeatures, featureEnabled } from "./features";
import { pushSupported, notificationPermission, subscribeToPush, unsubscribeFromPush } from "./web-push-client";

/**
 * React wiring for browser Web Push (roadmap 2.5 slice 3). A per-device, off-by-default control that is
 * only offered when the operator has enabled the `pushNotifications` module AND the browser actually supports
 * push. It reflects the live subscription state (a device is either registered or not) rather than a stored
 * preference, so it stays honest across browsers and after a permission reset.
 */

export type PushState = "unsupported" | "denied" | "off" | "on" | "busy";

export interface PushControl {
  /** Whether to render the control at all (module enabled + browser capable). */
  available: boolean;
  state: PushState;
  /** Turn push on (prompts for permission + subscribes) or off (unsubscribes). No-op while busy. */
  toggle: (on: boolean) => void;
}

/** Resolve the current push state for this device without side effects. */
async function readState(): Promise<PushState> {
  const perm = notificationPermission();
  if (perm === "unsupported") return "unsupported";
  if (perm === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

export function usePushNotifications(): PushControl {
  const { data: features } = useFeatures();
  const moduleOn = featureEnabled(features, "pushNotifications");
  const supported = pushSupported();
  const [state, setState] = useState<PushState>(supported ? "off" : "unsupported");

  useEffect(() => {
    if (!moduleOn || !supported) return;
    let cancelled = false;
    void readState().then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [moduleOn, supported]);

  const toggle = useCallback((on: boolean) => {
    setState((prev) => (prev === "busy" ? prev : "busy"));
    void (async () => {
      if (on) {
        const ok = await subscribeToPush().catch(() => false);
        setState(ok ? "on" : (notificationPermission() === "denied" ? "denied" : "off"));
      } else {
        await unsubscribeFromPush();
        setState("off");
      }
    })();
  }, []);

  return { available: moduleOn && supported, state, toggle };
}
