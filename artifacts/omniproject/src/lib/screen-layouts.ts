import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { ScreenLayout } from "./screen";

/**
 * Per-screen saved LAYOUTS — the drag-customised arrangement (panel order / spans / hidden). Roadmap X.10:
 * a saved layout is now FOLDED INTO the screen def (it rides on the org `screen` def in the def store, saved
 * through the importer by `EditableScreen`). This `screenLayouts` settings map survives only as a MIGRATION
 * BRIDGE — `useScreenLayouts` still reads a not-yet-folded legacy layout so it keeps applying, and the drain
 * clears the slice once the migration has folded every layout into its screen def.
 */
export type ScreenLayoutMap = Record<string, ScreenLayout>;

/** The LEGACY per-screen layout map (migration bridge). New layouts live on the screen def, not here. */
export function useScreenLayouts() {
  return useSettingsSlice((s) => (s["screenLayouts"] && typeof s["screenLayouts"] === "object" ? (s["screenLayouts"] as ScreenLayoutMap) : {}));
}

/** Drain the legacy `screenLayouts` slice to `{}` once every layout has been folded into its screen def. */
export function useDrainLegacyScreenLayouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<unknown>("/api/screen-layouts", { screenLayouts: {} }, "PUT", "Failed to drain legacy layouts"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}
