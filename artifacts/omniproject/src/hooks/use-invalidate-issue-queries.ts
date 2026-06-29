import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProjectIssuesQueryKey,
  getGetProjectSummaryQueryKey,
  getListProjectsQueryKey,
  getListActivityQueryKey,
} from "@workspace/api-client-react";

/**
 * After an issue mutation (create / update / delete / reschedule), the same set of cached views
 * must be refreshed: the project's issues + summary, the projects list (which carries roll-ups)
 * and the global activity feed. Several components hand-rolled this exact invalidation list,
 * which drifts the moment a key is renamed. This returns one stable invalidator so the set lives
 * in a single place.
 */
export function useInvalidateIssueQueries(): (projectId: string) => void {
  const qc = useQueryClient();
  return useCallback(
    (projectId: string) => {
      qc.invalidateQueries({ queryKey: getGetProjectIssuesQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getGetProjectSummaryQueryKey(projectId) });
      qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
    },
    [qc],
  );
}
