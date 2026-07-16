import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * One shared read of `/api/settings`, sliced. The SPA already fetches the full settings object; several
 * presentation-config hooks (screen defs, disabled screens, screen layouts, methodology composition) are
 * just slices of it. Reading them all under the SINGLE `["settings"]` query key means React-Query dedupes
 * them into ONE network request (instead of a separate GET per hook), and each `select` picks its slice —
 * removing the per-screen config-fetch fan-out. Writers invalidate this key to refresh every slice at once.
 */
export const settingsQueryKey = ["settings"] as const;

/** The redacted settings object as an untyped bag; each caller narrows its slice via `select`. */
export type SettingsBag = Record<string, unknown>;

function fetchSettings(): Promise<SettingsBag> {
  return getJson<SettingsBag>("/api/settings");
}

/** Subscribe to one slice of the shared settings read. `staleTime` matches the old per-hook value so
 *  cache behaviour is unchanged; only the number of requests drops. */
export function useSettingsSlice<T>(select: (s: SettingsBag) => T): UseQueryResult<T> {
  return useQuery({ queryKey: settingsQueryKey, queryFn: fetchSettings, staleTime: 30_000, select });
}
