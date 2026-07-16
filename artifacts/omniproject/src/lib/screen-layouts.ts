import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { ScreenLayout } from "./screen";

/**
 * Per-screen saved LAYOUTS client. A layout is the drag-customised arrangement (panel order / spans /
 * hidden) an admin or PMO applies to a generic ScreenRenderer screen, keyed by screen id. Like dashboards
 * and saved views, layouts are SHARED, customer-level presentation config persisted to the config bundle
 * via /api/screen-layouts — any authenticated user reads them, but WRITES are gated to `pmo` server-side.
 * Benign presentation config, never project data.
 */
export type ScreenLayoutMap = Record<string, ScreenLayout>;

export function useScreenLayouts() {
  return useSettingsSlice((s) => (s["screenLayouts"] && typeof s["screenLayouts"] === "object" ? (s["screenLayouts"] as ScreenLayoutMap) : {}));
}

/** Persist the full layout map (CSRF attached by the global fetch patch). PMO-gated server-side. */
export function useSaveScreenLayouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (screenLayouts: ScreenLayoutMap) => {
      return sendJson<unknown>("/api/screen-layouts", { screenLayouts }, "PUT", "Failed to save screen layout");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}
