import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

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

export function useStakeholders() {
  return useQuery({
    queryKey: stakeholdersQueryKey,
    queryFn: () => getJson<{ stakeholders: Stakeholder[] }>("/api/stakeholders").then((r) => r.stakeholders ?? []),
    staleTime: 30_000,
  });
}

export function useSaveStakeholders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stakeholders: Stakeholder[]) => sendJson<unknown>("/api/stakeholders", { stakeholders }, "PUT", "Failed to save stakeholders"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: stakeholdersQueryKey }); qc.invalidateQueries({ queryKey: ["panel-data"] }); },
  });
}
