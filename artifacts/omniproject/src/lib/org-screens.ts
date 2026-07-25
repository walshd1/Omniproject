import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson } from "./api";
import { useResolvedDefs, useImportDef, useUpdateDef } from "./defs";
import { mergeScreens, resolveScreenDef, screenDefs, type ScreenCatalogueEntry } from "./screen-catalogue";

/**
 * Org screen-defs client + resolution. A screen a PMO builds or modifies is an ARTIFACT in the encrypted def
 * store (authored through the ONE importer, kind `screen`); here we fetch the effective OVERRIDE set from
 * `GET /api/screen-defs/resolved` (org/project/user def-store screens) and MERGE it over the built-in screen
 * catalogue — an override wins by id, or adds a net-new screen (e.g. from a methodology bundle). The one
 * generic builder (the ENGINE) renders whatever wins.
 */
export type OrgScreenDef = ScreenCatalogueEntry;

export const screenDefsResolvedKey = ["screen-defs", "resolved"] as const;

/** The effective org screen OVERRIDES (org/project/user def store, nearest scope winning). */
export function useOrgScreenDefs() {
  return useQuery({
    queryKey: screenDefsResolvedKey,
    queryFn: async () => (await getJson<{ screenDefs: OrgScreenDef[] }>("/api/screen-defs/resolved")).screenDefs ?? [],
    staleTime: 15_000,
  });
}

/**
 * UPSERT one org screen OVERRIDE def through the importer (the ONE write path): PUT the existing org `screen`
 * def in place, else POST a new one. `def.id` pins which built-in it overrides. Shared by the Screens admin
 * (content override) and EditableScreen (folded layout) so both go through the same choke point. Returns a
 * `save(def)` and a `saving` flag; invalidates the resolved-screens cache on success.
 */
export function useSaveScreenOverride() {
  const qc = useQueryClient();
  const { data: defs } = useResolvedDefs<OrgScreenDef>("screen");
  const orgDefs = useMemo(() => (Array.isArray(defs) ? defs : []).filter((d) => d.id.startsWith("org~")), [defs]);
  const scopedIdByScreenId = useMemo(() => new Map(orgDefs.map((d) => [(d.payload as OrgScreenDef).id, d.id])), [orgDefs]);
  const importDef = useImportDef();
  const updateDef = useUpdateDef();
  const save = async (def: OrgScreenDef): Promise<void> => {
    const scopedId = scopedIdByScreenId.get(def.id);
    const name = String(def.label ?? def.id);
    if (scopedId) await updateDef.mutateAsync({ id: scopedId, name, payload: def });
    else await importDef.mutateAsync({ kind: "screen", storage: "org", name, payload: def });
    await qc.invalidateQueries({ queryKey: screenDefsResolvedKey });
  };
  return { save, saving: importDef.isPending || updateDef.isPending, orgDefs, scopedIdByScreenId };
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
