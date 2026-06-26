/**
 * Effort / time-tracking maths — pure, so the estimate-vs-logged progress and
 * its banding are unit-tested and shared. All inputs are hours (or null when the
 * backend doesn't track that field).
 */
export type EffortBand = "under" | "near" | "over" | "unknown";

export interface EffortProgress {
  /** Logged ÷ estimate as a percentage, clamped to ≥ 0 (can exceed 100). */
  pct: number;
  /** A bar width 0–100 for display (clamped). */
  barPct: number;
  band: EffortBand;
  /** estimate − logged, when both known (negative ⇒ overrun). null otherwise. */
  variance: number | null;
}

/**
 * Where logged effort sits against the estimate.
 *  - under   : comfortably within estimate (< 90%)
 *  - near    : approaching the estimate (90–100%)
 *  - over    : logged has exceeded the estimate (> 100%)
 *  - unknown : no usable estimate to compare against
 */
export function effortProgress(
  estimate: number | null | undefined,
  logged: number | null | undefined,
): EffortProgress {
  const est = typeof estimate === "number" && Number.isFinite(estimate) ? estimate : null;
  const log = typeof logged === "number" && Number.isFinite(logged) ? Math.max(0, logged) : null;

  if (est == null || est <= 0 || log == null) {
    return { pct: 0, barPct: 0, band: "unknown", variance: est != null && log != null ? est - log : null };
  }
  const pct = Math.round((log / est) * 100);
  const barPct = Math.max(0, Math.min(100, pct));
  const band: EffortBand = pct > 100 ? "over" : pct >= 90 ? "near" : "under";
  return { pct, barPct, band, variance: est - log };
}
