/**
 * Portfolio-prioritisation weights — the SHARED shape + shipped default for the composite ranking
 * score, the single source of truth for BOTH planes (the api-server seeds/validates the saved config
 * against it; the SPA falls back to it while the saved weights load and runs the scoring maths on it).
 * It used to be hand-copied into api-server/lib/settings.ts and omniproject/lib/portfolio-priority.ts,
 * which had already begun to drift in their comments — collapse them here. Pure data, zero deps.
 */

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

/** The shipped default weighting — the seed for the saved config and the SPA's loading fallback. */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = { rice: 25, wsjf: 25, moscow: 15, strategic: 15, benefit: 20 };
