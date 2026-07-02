import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getJson, sendJson } from "./api";
import { DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from "./portfolio-priority";

/**
 * Portfolio prioritisation scoring weights client (backlog #98). Any authed user reads them (so the
 * ranking renders identically for everyone); tuning is PMO-gated server-side. The weights are the ONLY
 * persisted part of the prioritisation view — the score itself is computed live over the read model on
 * every render. Mirrors lib/custom-reports-api.ts.
 */
export const priorityWeightsQueryKey = ["portfolio-priority-weights"] as const;

/** The saved prioritisation weights, defaulting to DEFAULT_PRIORITY_WEIGHTS while unset/loading. */
export function usePriorityWeights() {
  return useQuery({
    queryKey: priorityWeightsQueryKey,
    queryFn: () => getJson<{ priorityWeights: PriorityWeights }>("/api/portfolio/priority-weights").then((r) => r.priorityWeights),
    staleTime: 30_000,
  });
}

/** Persist the prioritisation weights (pmo). */
export function useSavePriorityWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (priorityWeights: PriorityWeights) =>
      sendJson<{ priorityWeights: PriorityWeights }>("/api/portfolio/priority-weights", { priorityWeights }),
    onSuccess: (data) => qc.setQueryData(priorityWeightsQueryKey, data.priorityWeights),
  });
}

export { DEFAULT_PRIORITY_WEIGHTS };
export type { PriorityWeights };
