import { useQuery } from "@tanstack/react-query";
import { getJson } from "./api";

/**
 * Availability client — what the connected backend ACTUALLY surfaces (superset ∩ the backend's
 * schema manifest if it has one, else the static capability flags). Lets the SPA show only the
 * fields/tables the backend genuinely holds; admin/PMO view-curation layers on top.
 */
export interface Availability {
  source: "manifest" | "capabilities";
  fields: string[];
  tables: string[];
  relationships: { from: string; field: string; to: string }[];
}

export function useAvailability() {
  return useQuery({
    queryKey: ["availability"],
    queryFn: () => getJson<Availability>("/api/availability"),
    staleTime: 30_000,
  });
}

/** True when a canonical field is surfaced by the backend (defaults to true while loading). */
export function fieldAvailable(a: Availability | undefined, key: string): boolean {
  return a ? a.fields.includes(key) : true;
}
