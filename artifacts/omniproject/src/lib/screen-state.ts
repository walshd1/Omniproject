import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";

/**
 * The OFF switch for screens (companion to the override store in lib/org-screens). An admin/PMO turns a
 * screen off and its id is stored in the deployment config; the SPA hides it from nav and the builder shows
 * a "turned off" state. Reads open; writes gated to admin OR pmo server-side.
 */
export function useDisabledScreens() {
  return useSettingsSlice((s) => (Array.isArray(s["disabledScreens"]) ? (s["disabledScreens"] as string[]) : []));
}

/** Persist the full disabled-screens list. Admin/PMO-gated server-side. */
export function useSaveDisabledScreens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (disabledScreens: string[]) => sendJson<unknown>("/api/disabled-screens", { disabledScreens }, "PUT", "Failed to save screen states"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}

/** Whether a screen id is turned off. Pure. */
export function isScreenDisabled(disabled: readonly string[] | undefined, id: string): boolean {
  return !!disabled && disabled.includes(id);
}
