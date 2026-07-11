import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

/**
 * Availability client — what the connected backend ACTUALLY surfaces (superset ∩ the backend's
 * schema manifest if it has one, else the static capability flags), trimmed by admin/PMO
 * view-curation. `fields` is the net set to render; `available` is the full backend set the
 * curation panel can hide; `hidden` is the curation in effect.
 */
export interface Availability {
  source: "manifest" | "capabilities";
  fields: string[];
  available: string[];
  hidden: string[];
  tables: string[];
  relationships: { from: string; field: string; to: string }[];
}

export const availabilityQueryKey = ["availability"] as const;

export function useAvailability() {
  return useQuery({
    queryKey: availabilityQueryKey,
    queryFn: () => getJson<Availability>("/api/availability"),
    staleTime: 30_000,
  });
}

/** True when a canonical field is surfaced by the backend AND not curated out (defaults to true
 *  while loading, so core UI never flickers off). */
export function fieldVisible(a: Availability | undefined, key: string): boolean {
  return a ? a.fields.includes(key) : true;
}

/** Persist the admin/PMO hidden-field curation (admin OR pmo). CSRF is attached by the global
 *  fetch patch (lib/csrf). */
export function useSetHiddenFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hiddenFields: string[]) => {
      return sendJson<unknown>("/api/availability/curation", { hiddenFields }, "PATCH", "Failed to update field visibility");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: availabilityQueryKey });
    },
  });
}
