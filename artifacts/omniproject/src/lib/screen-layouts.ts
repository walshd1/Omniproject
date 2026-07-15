import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import type { ScreenLayout } from "./screen";

/**
 * Per-screen saved LAYOUTS client. A layout is the drag-customised arrangement (panel order / spans /
 * hidden) an admin or PMO applies to a generic ScreenRenderer screen, keyed by screen id. Like dashboards
 * and saved views, layouts are SHARED, customer-level presentation config persisted to the config bundle
 * via /api/screen-layouts — any authenticated user reads them, but WRITES are gated to `pmo` server-side.
 * Benign presentation config, never project data.
 */
export type ScreenLayoutMap = Record<string, ScreenLayout>;

export const screenLayoutsQueryKey = ["screen-layouts"] as const;

export function useScreenLayouts() {
  return useQuery({
    queryKey: screenLayoutsQueryKey,
    queryFn: () => getJson<{ screenLayouts: ScreenLayoutMap }>("/api/screen-layouts").then((r) => r.screenLayouts ?? {}),
    staleTime: 30_000,
  });
}

/** Persist the full layout map (CSRF attached by the global fetch patch). PMO-gated server-side. */
export function useSaveScreenLayouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (screenLayouts: ScreenLayoutMap) => {
      return sendJson<unknown>("/api/screen-layouts", { screenLayouts }, "PUT", "Failed to save screen layout");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: screenLayoutsQueryKey });
    },
  });
}
