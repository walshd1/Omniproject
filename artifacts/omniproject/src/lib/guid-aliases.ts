import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { closedProjectsQueryKey } from "./closed-projects";

export type GuidAliases = Record<string, string>;
export const guidAliasesQueryKey = ["guid-aliases"] as const;

export function useGuidAliases() {
  return useQuery({
    queryKey: guidAliasesQueryKey,
    queryFn: () => getJson<{ guidAliases?: GuidAliases }>("/api/guid-aliases").then((r) => r.guidAliases ?? {}),
    staleTime: 0,
  });
}

/** Persist the relink table (PMO/admin). The server rejects self-aliases and cycles. */
export function useSaveGuidAliases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (aliases: GuidAliases) => sendJson("/api/guid-aliases", { guidAliases: aliases }, "PUT", "Failed to save GUID aliases"),
    onSuccess: () => qc.invalidateQueries({ queryKey: guidAliasesQueryKey }),
  });
}

export interface ForgetResult {
  guid: string;
  removedFromClosed: boolean;
  removedFromProgrammes: string[];
  removedAliases: number;
}

/** "Delete" a project = forget its GUID from every OmniProject list (PMO/admin). Never touches the
 *  project's data in a backend or the archive. */
export function useForgetProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (guid: string) => sendJson<ForgetResult>(`/api/projects/${encodeURIComponent(guid)}/links`, {}, "DELETE", "Failed to forget project"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: closedProjectsQueryKey });
      qc.invalidateQueries({ queryKey: guidAliasesQueryKey });
      qc.invalidateQueries({ queryKey: ["programme-registry"] });
    },
  });
}
