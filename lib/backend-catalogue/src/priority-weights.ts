/**
 * Portfolio-prioritisation weights — the SHARED shape + shipped default for the composite ranking
 * score, the single source of truth for BOTH planes (the api-server seeds/validates the saved config
 * against it; the SPA falls back to it while the saved weights load and runs the scoring maths on it).
 * It used to be hand-copied into api-server/lib/settings.ts and omniproject/lib/portfolio-priority.ts,
 * which had already begun to drift in their comments — collapse them here. The shipped default VALUES
 * are authored as JSON (assets/priority-weights.json → gen-priority-weights), so the keypairs live in
 * data, not code; admin/PMO tune the live values through the settings store. Pure data, zero deps.
 */
import { PRIORITY_WEIGHTS_DATA } from "./priority-weights.generated";

/**
 * The relative weight of each prioritisation dimension in the composite score. Values are RELATIVE,
 * not required to sum to 100: the composite renormalises over whichever dimensions a project actually
 * reports data for. A weight of 0 switches a dimension off entirely.
 */
export interface PriorityWeights {
  rice: number;
  wsjf: number;
  moscow: number;
  strategic: number;
  benefit: number;
}

/** One authored {dimension → default weight} seed pair (the JSON asset's element shape). */
export interface PriorityWeightSeed {
  key: keyof PriorityWeights;
  weight: number;
}

/** The shipped default weighting — the seed for the saved config and the SPA's loading fallback.
 *  Built from the JSON asset so the keypairs + values live in data, not a hand-written literal. */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = Object.fromEntries(
  PRIORITY_WEIGHTS_DATA.map((w) => [w.key, w.weight]),
) as unknown as PriorityWeights;
