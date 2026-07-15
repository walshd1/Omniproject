import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { mergeScreens, resolveScreenDef, screenDefs, type ScreenCatalogueEntry } from "./screen-catalogue";

/**
 * Org screen-defs client + resolution. A screen a PMO builds or modifies is stored in the org's (encrypted)
 * config via /api/screen-defs; here we fetch it and MERGE it over the built-in screen catalogue — an org def
 * OVERRIDES a built-in of the same id, or adds a net-new screen (e.g. from a methodology bundle). The one
 * generic builder then renders whatever wins. Reads are open; writes are pmo-gated server-side.
 */
export type OrgScreenDef = ScreenCatalogueEntry;

export const orgScreensQueryKey = ["screen-defs"] as const;

export function useOrgScreenDefs() {
  return useQuery({
    queryKey: orgScreensQueryKey,
    queryFn: () => getJson<{ screenDefs: OrgScreenDef[] }>("/api/screen-defs").then((r) => r.screenDefs ?? []),
    staleTime: 30_000,
  });
}

/** Persist the full org screen-defs list (CSRF attached by the global fetch patch). PMO-gated server-side. */
export function useSaveOrgScreenDefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (screenDefs: OrgScreenDef[]) => sendJson<unknown>("/api/screen-defs", { screenDefs }, "PUT", "Failed to save screens"),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgScreensQueryKey }),
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
