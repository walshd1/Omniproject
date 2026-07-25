import { configResource } from "./config-resource";

/**
 * Stakeholder register client. Flat (name, role, influence, interest, engagement) rows stored as shared
 * config via /api/stakeholders; the Stakeholders screen renders the rows generically. Reads open; writes
 * manager-gated server-side.
 */
export type Level = "low" | "medium" | "high";
export interface Stakeholder {
  id: string;
  name: string;
  role: string;
  influence: Level;
  interest: Level;
  engagement?: string;
  projectId?: string;
}

export const stakeholdersQueryKey = ["stakeholders"] as const;

const resource = configResource<Stakeholder[]>({
  queryKey: stakeholdersQueryKey,
  path: "/api/stakeholders",
  envelopeKey: "stakeholders",
  empty: [],
  saveErrorMessage: "Failed to save stakeholders", // manager-gated server-side
  alsoInvalidate: [["panel-data"]], // the Stakeholders screen renders the rows generically under panel-data
});
export const useStakeholders = resource.useResource;
export const useSaveStakeholders = resource.useSaveResource;
