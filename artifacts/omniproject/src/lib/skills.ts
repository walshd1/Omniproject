import { useQuery } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DemandRequest, ResourceSkills } from "./skills-capacity";

/**
 * Skills-planning client — the DATA SOURCE for the skills-capacity report. Skills aren't a canonical
 * work-item field, so the matrix + demand are PLANNING CONFIG stored in settings (like rate cards /
 * priority weights), read via `GET /api/settings` and edited by admin/PMO via `PATCH /api/settings`.
 */
export interface SkillsPlanning {
  matrix: ResourceSkills[];
  demand: DemandRequest[];
}

export const skillsPlanningQueryKey = ["skills-planning"] as const;

/** Read the skills matrix + demand (empty when unconfigured). */
export function useSkillsPlanning() {
  return useQuery({
    queryKey: skillsPlanningQueryKey,
    queryFn: () =>
      getJson<{ skillsPlanning?: SkillsPlanning }>("/api/settings").then((s) => s.skillsPlanning ?? { matrix: [], demand: [] }),
    staleTime: 30_000,
  });
}

/** Persist the skills matrix + demand (admin/PMO). Bounded server-side by settings validation. */
export function useSaveSkillsPlanning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (skillsPlanning: SkillsPlanning) => sendJson("/api/settings", { skillsPlanning }, "PATCH"),
    onSuccess: () => qc.invalidateQueries({ queryKey: skillsPlanningQueryKey }),
  });
}
