import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

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

export function useRaci() {
  return useQuery({
    queryKey: raciQueryKey,
    queryFn: () => getJson<{ raci: RaciEntry[] }>("/api/raci").then((r) => r.raci ?? []),
    staleTime: 30_000,
  });
}

export function useSaveRaci() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (raci: RaciEntry[]) => sendJson<unknown>("/api/raci", { raci }, "PUT", "Failed to save RACI"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: raciQueryKey }); qc.invalidateQueries({ queryKey: ["panel-data"] }); },
  });
}
