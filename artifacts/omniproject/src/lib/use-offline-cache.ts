import { useEffect } from "react";
import { create } from "zustand";
import { useQueryClient } from "@tanstack/react-query";
import { useFeatures, featureEnabled } from "./features";
import { useAuth } from "./auth";
import { isCacheableKey, saveEntry, loadEntries, clearOfflineCache } from "./offline-cache";

/**
 * React wiring for the encrypted offline cache (roadmap 2.5 slice 2). A per-user, off-by-default toggle
 * (`offlineCache` feature module must also be enabled), a hydrate-on-open step that seeds the query cache
 * from the encrypted store (so my-work/tasks render offline), and a subscriber that writes allow-listed
 * query results back. Turning the toggle OFF wipes the store immediately; logout wipes it too (lib/auth).
 */

const LOCAL_KEY = "omni.offlineCache";
function loadEnabled(): boolean {
  try { return localStorage.getItem(LOCAL_KEY) === "1"; } catch { return false; }
}

interface OfflineCacheSetting {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useOfflineCacheSetting = create<OfflineCacheSetting>((set) => ({
  enabled: loadEnabled(),
  setEnabled: (v) => {
    try { localStorage.setItem(LOCAL_KEY, v ? "1" : "0"); } catch { /* storage blocked */ }
    if (!v) void clearOfflineCache(); // turning it off purges whatever was cached
    set({ enabled: v });
  },
}));

/** True only when the module is enabled by the operator AND the user opted in. */
export function useOfflineCacheActive(): boolean {
  const { data: features } = useFeatures();
  const userOn = useOfflineCacheSetting((s) => s.enabled);
  return featureEnabled(features, "offlineCache") && userOn;
}

/**
 * Mount ONCE (in the authenticated shell). When the offline cache is active for the signed-in user it:
 *   1. hydrates the query cache from the encrypted store for keys that have no live data yet (so a cold /
 *      offline open shows my work), and
 *   2. subscribes to the query cache and writes allow-listed results back, encrypted.
 * A no-op (and a safe teardown) when inactive.
 */
export function useOfflineCacheSync(): void {
  const active = useOfflineCacheActive();
  const qc = useQueryClient();
  const sub = useAuth().data?.user?.sub;

  useEffect(() => {
    if (!active || !sub) return;
    let cancelled = false;

    // 1. Hydrate: seed only where the live cache is empty, so we never clobber fresher data.
    void loadEntries(sub).then((entries) => {
      if (cancelled) return;
      for (const { key, data } of entries) {
        if (qc.getQueryData(key as unknown[]) === undefined) qc.setQueryData(key as unknown[], data);
      }
    });

    // 2. Persist allow-listed query results as they resolve.
    const unsubscribe = qc.getQueryCache().subscribe((event) => {
      const q = event.query;
      if (!isCacheableKey(q.queryKey)) return;
      const data = q.state.data;
      if (data === undefined || q.state.status !== "success") return;
      void saveEntry(sub, q.queryKey, data);
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [active, sub, qc]);
}
