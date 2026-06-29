import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, safeJson, responseError } from "./api";

/**
 * Feature-module client. The gateway exposes optional backend modules that an operator can switch
 * off (opt-out); this drives the admin toggle panel and lets the SPA lazily gate optional UI.
 */
export interface FeatureStatus {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Loaded + mounted this process (was enabled at startup). */
  loaded: boolean;
  /** Enabled now but not loaded — needs a restart to take effect. */
  needsRestart: boolean;
}

export const featuresQueryKey = ["features"] as const;

/** The status of every optional feature module. */
export function useFeatures() {
  return useQuery({
    queryKey: featuresQueryKey,
    queryFn: () => getJson<{ features: FeatureStatus[] }>("/api/features").then((r) => r.features),
    staleTime: 30_000,
  });
}

/** True when a feature module is enabled (for lazily gating optional UI). Defaults to true while
 *  the list is still loading, so core UI never flickers off. */
export function featureEnabled(features: FeatureStatus[] | undefined, id: string): boolean {
  const f = features?.find((x) => x.id === id);
  return f ? f.enabled : true;
}

/** Persist the opt-out set (admin). CSRF is attached by the global fetch patch (lib/csrf). */
export function useSetDisabledFeatures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (disabledFeatures: string[]) => {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledFeatures }),
      });
      if (!res.ok) throw responseError(res, await safeJson(res), "Failed to update feature modules");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: featuresQueryKey });
    },
  });
}
