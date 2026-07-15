import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * The OFF switch for screens (companion to the override store in lib/org-screens). An admin/PMO turns a
 * screen off and its id is stored in the deployment config; the SPA hides it from nav and the builder shows
 * a "turned off" state. Reads open; writes gated to admin OR pmo server-side.
 */
export const disabledScreensQueryKey = ["disabled-screens"] as const;

export function useDisabledScreens() {
  return useQuery({
    queryKey: disabledScreensQueryKey,
    queryFn: () => getJson<{ disabledScreens: string[] }>("/api/disabled-screens").then((r) => r.disabledScreens ?? []),
    staleTime: 30_000,
  });
}

/** Persist the full disabled-screens list. Admin/PMO-gated server-side. */
export function useSaveDisabledScreens() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (disabledScreens: string[]) => sendJson<unknown>("/api/disabled-screens", { disabledScreens }, "PUT", "Failed to save screen states"),
    onSuccess: () => qc.invalidateQueries({ queryKey: disabledScreensQueryKey }),
  });
}

/** Whether a screen id is turned off. Pure. */
export function isScreenDisabled(disabled: readonly string[] | undefined, id: string): boolean {
  return !!disabled && disabled.includes(id);
}
