import { configResource } from "./config-resource";

/**
 * RACI register client. Flat (task, role, responsibility) assignments stored as shared config via /api/raci;
 * the RACI screen renders the rows (/api/raci/rows) generically. Reads open; writes manager-gated server-side.
 */
export type RaciResponsibility = "R" | "A" | "C" | "I";
export interface RaciEntry {
  id: string;
  task: string;
  role: string;
  responsibility: RaciResponsibility;
  projectId?: string;
}

export const raciQueryKey = ["raci"] as const;

const resource = configResource<RaciEntry[]>({
  queryKey: raciQueryKey,
  path: "/api/raci",
  envelopeKey: "raci",
  empty: [],
  saveErrorMessage: "Failed to save RACI", // manager-gated server-side
  alsoInvalidate: [["panel-data"]], // the RACI screen renders the rows generically under panel-data
});
export const useRaci = resource.useResource;
export const useSaveRaci = resource.useSaveResource;
