import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";

export const PROJECT_DISPOSITIONS = ["sor", "archive"] as const;
export type ProjectDisposition = (typeof PROJECT_DISPOSITIONS)[number];

/** Where a closed project's data lives, and where it closed. */
export interface ClosedProjectRecord {
  disposition: ProjectDisposition;
  source?: string;
  closedAt?: string;
  note?: string;
}
export type ClosedProjectRegistry = Record<string, ClosedProjectRecord>;

export const closedProjectsQueryKey = ["closed-projects"] as const;

export function useClosedProjects() {
  return useQuery({
    queryKey: closedProjectsQueryKey,
    queryFn: () => getJson<{ closedProjects?: ClosedProjectRegistry }>("/api/closed-projects").then((r) => r.closedProjects ?? {}),
    staleTime: 0,
  });
}

/** Persist the closed-project registry (PMO/admin). The server re-validates. */
export function useSaveClosedProjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (registry: ClosedProjectRegistry) => sendJson("/api/closed-projects", { closedProjects: registry }, "PUT", "Failed to save closed projects"),
    onSuccess: () => qc.invalidateQueries({ queryKey: closedProjectsQueryKey }),
  });
}
