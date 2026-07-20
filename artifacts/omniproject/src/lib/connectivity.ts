import { useEffect, useState } from "react";

/**
 * Connectivity — true device online/offline state (roadmap 2.5). Distinct from the gateway HEALTH check:
 * `navigator.onLine` tells us whether the DEVICE has a network at all, while the health poll tells us whether
 * the API is reachable + healthy. The header combines them so "offline" (no network) reads differently from
 * "can't reach the gateway". Safe in SSR/tests (no `window`/`navigator` ⇒ assume online, never a false
 * offline flash).
 */

/** The three connectivity states the chrome distinguishes. */
export type ConnectivityState = "connected" | "unreachable" | "offline";

/** Pure: resolve the state from device-online + gateway-healthy. Device offline dominates (no point blaming
 *  the gateway when there's no network at all). */
export function connectivityState(online: boolean, healthy: boolean): ConnectivityState {
  if (!online) return "offline";
  return healthy ? "connected" : "unreachable";
}

/** Live device online/offline state, updated on the browser's `online`/`offline` events. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Re-sync in case the state changed between first render and effect attach.
    setOnline(navigator.onLine !== false);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}
