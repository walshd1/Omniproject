import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { closedProjectsQueryKey, type ClosedProjectRecord } from "./closed-projects";
import { configResource } from "./config-resource";
import { triggerBlobDownload } from "./setup";

export type GuidAliases = Record<string, string>;
export const guidAliasesQueryKey = ["guid-aliases"] as const;

const resource = configResource<GuidAliases>({
  queryKey: guidAliasesQueryKey,
  path: "/api/guid-aliases",
  envelopeKey: "guidAliases",
  empty: {},
  staleTime: 0,
  saveErrorMessage: "Failed to save GUID aliases", // server rejects self-aliases and cycles (PMO/admin)
});
export const useGuidAliases = resource.useResource;
/** Persist the relink table (PMO/admin). The server rejects self-aliases and cycles. */
export const useSaveGuidAliases = resource.useSaveResource;

export interface ForgetResult {
  guid: string;
  removedFromClosed: boolean;
  removedFromProgrammes: string[];
  removedAliases: number;
}

export interface ProjectReferences {
  guid: string;
  closed: ClosedProjectRecord | null;
  programmes: string[];
  aliasedFrom: string[];
  aliasTo: string | null;
  retired: boolean;
}

/** Fetch everything OmniProject holds about a project GUID and download it as JSON — the "export before
 *  delete" step, so nothing is lost silently. */
export async function exportProjectReferences(guid: string): Promise<ProjectReferences> {
  const refs = await getJson<ProjectReferences>(`/api/projects/${encodeURIComponent(guid)}/references`);
  triggerBlobDownload(new Blob([JSON.stringify(refs, null, 2)], { type: "application/json" }), `omniproject-${guid}.json`);
  return refs;
}

/** "Delete" a project = forget its GUID from every OmniProject list (PMO/admin), tombstoning it so it
 *  can't silently reactivate. Never touches the project's data in a backend or the archive. */
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
