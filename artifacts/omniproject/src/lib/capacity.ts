/**
 * Capacity banding — pure, so the "over / at a given level" logic is unit-tested
 * and shared. Utilisation is a percentage (allocated ÷ available × 100); null
 * means the backend doesn't supply the hours to compute it.
 */
export type CapacityBand = "over" | "at" | "under" | "unknown";

/**
 * Where a person's utilisation sits against a chosen threshold.
 *  - over    : > 100% (genuinely over capacity)
 *  - at      : ≥ threshold but ≤ 100% (at/approaching the chosen level)
 *  - under   : below the threshold
 *  - unknown : no utilisation figure
 */
export function capacityBand(util: number | null, threshold: number): CapacityBand {
  if (util == null) return "unknown";
  if (util > 100) return "over";
  if (util >= threshold) return "at";
  return "under";
}

export interface CapacitySummary {
  /** People genuinely over capacity (> 100%). */
  over: number;
  /** People at/over the chosen threshold but not over capacity. */
  at: number;
  /** People with a known utilisation (the denominator for "flagged"). */
  tracked: number;
}

export function capacitySummary(utils: Array<number | null>, threshold: number): CapacitySummary {
  let over = 0;
  let at = 0;
  let tracked = 0;
  for (const u of utils) {
    const band = capacityBand(u, threshold);
    if (band === "unknown") continue;
    tracked++;
    if (band === "over") over++;
    else if (band === "at") at++;
  }
  return { over, at, tracked };
}
