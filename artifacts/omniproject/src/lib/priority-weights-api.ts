import { configResource } from "./config-resource";
import { DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from "./portfolio-priority";

/**
 * Portfolio prioritisation scoring weights client (backlog #98). Any authed user reads them (so the
 * ranking renders identically for everyone); tuning is PMO-gated server-side. The weights are the ONLY
 * persisted part of the prioritisation view — the score itself is computed live over the read model on
 * every render. Mirrors lib/custom-reports-api.ts.
 */
export const priorityWeightsQueryKey = ["portfolio-priority-weights"] as const;

const resource = configResource<PriorityWeights>({
  queryKey: priorityWeightsQueryKey,
  path: "/api/portfolio/priority-weights",
  envelopeKey: "priorityWeights",
  reconcile: "set-from-response", // pmo-gated; the endpoint echoes the saved weights back
});
/** The saved prioritisation weights, defaulting to DEFAULT_PRIORITY_WEIGHTS while unset/loading. */
export const usePriorityWeights = resource.useResource;
/** Persist the prioritisation weights (pmo). */
export const useSavePriorityWeights = resource.useSaveResource;

export { DEFAULT_PRIORITY_WEIGHTS };
export type { PriorityWeights };
