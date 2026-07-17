import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { settingsQueryKey } from "./settings-query";
import { mergeScreens, resolveScreenDef, screenDefs, type ScreenCatalogueEntry } from "./screen-catalogue";

/**
 * Org screen-defs client + resolution. A screen a PMO builds or modifies is an ARTIFACT in the encrypted def
 * store now (authored through the ONE importer, kind `screen`); here we fetch the effective OVERRIDE set from
 * `GET /api/screen-defs/resolved` (the server unions the def-store screens with any not-yet-migrated legacy
 * `settings.screenDefs`) and MERGE it over the built-in screen catalogue — an override wins by id, or adds a
 * net-new screen (e.g. from a methodology bundle). The one generic builder (the ENGINE) renders whatever wins.
 */
export type OrgScreenDef = ScreenCatalogueEntry;

export const screenDefsResolvedKey = ["screen-defs", "resolved"] as const;
export const legacyScreenDefsKey = ["screen-defs", "legacy"] as const;

/** The effective org screen OVERRIDES (def store + legacy bridge, def store winning). */
export function useOrgScreenDefs() {
  return useQuery({
    queryKey: screenDefsResolvedKey,
    queryFn: async () => (await getJson<{ screenDefs: OrgScreenDef[] }>("/api/screen-defs/resolved")).screenDefs ?? [],
    staleTime: 15_000,
  });
}

/** The LEGACY `settings.screenDefs` slice — only for the one-shot migration (read the old list, import each as
 *  a def, then drain). Not the render source. */
export function useLegacyOrgScreenDefs() {
  return useQuery({
    queryKey: legacyScreenDefsKey,
    queryFn: async () => (await getJson<{ screenDefs: OrgScreenDef[] }>("/api/screen-defs")).screenDefs ?? [],
    staleTime: 30_000,
  });
}

/** Drain the legacy `settings.screenDefs` slice to [] once its overrides have been re-imported as defs. */
export function useDrainLegacyScreenDefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJson<unknown>("/api/screen-defs", { screenDefs: [] }, "PUT", "Failed to drain legacy screens"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: legacyScreenDefsKey });
      qc.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
}

/** The EFFECTIVE screen catalogue for this session: built-ins merged with the org's stored defs. */
export function useResolvedScreens(): ScreenCatalogueEntry[] {
  const { data: org } = useOrgScreenDefs();
  return useMemo(() => mergeScreens(org ?? []), [org]);
}

/** Resolve one screen def by id from the effective catalogue (org override wins over the built-in). */
export function useScreenDef(id: string): ScreenCatalogueEntry | undefined {
  const { data: org } = useOrgScreenDefs();
  return useMemo(() => resolveScreenDef(id, org ?? []), [id, org]);
}

/** The effective routed screens (built-in + org) — those declaring a `route`, for nav + routing. */
export function useRoutedScreens(): ScreenCatalogueEntry[] {
  const resolved = useResolvedScreens();
  return useMemo(() => resolved.filter((s) => typeof s.route === "string" && s.route.length > 0), [resolved]);
}

// Re-export so callers importing "the catalogue" get the built-in list from one place.
export { screenDefs };
