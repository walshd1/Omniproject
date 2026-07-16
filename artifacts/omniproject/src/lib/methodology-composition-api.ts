import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendJson } from "./api";
import { useSettingsSlice, settingsQueryKey } from "./settings-query";
import type { Composition } from "./methodology-composition";

/**
 * Client read/write for the methodology composition (settings.methodologyComposition). Read as a SLICE of
 * the one shared `/api/settings` query (deduped with the other shared-config reads — see settings-query);
 * write via PATCH, invalidating that shared read. `null` = uncurated.
 */
export function useMethodologyComposition() {
  return useSettingsSlice((s) => (s["methodologyComposition"] as Composition | undefined) ?? null);
}

export function useSaveMethodologyComposition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (methodologyComposition: Composition) =>
      sendJson("/api/settings", { methodologyComposition }, "PATCH", "Failed to save the methodology composition"),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsQueryKey }),
  });
}
