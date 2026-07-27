/**
 * CAPACITY-BASED SPRINT / PI FORECASTING — "when will this backlog be done?" answered from throughput, not a
 * hand-drawn plan (roadmap §4.5, "capacity-based sprint/PI forecasting"). Given a remaining backlog (story points
 * or effort) and a team's per-sprint velocity, it forecasts how many sprints — and how many Program Increments —
 * are needed to clear it, with an optimistic / likely / pessimistic band so a PMO sees the spread, not a false
 * single date.
 *
 * Complements run-rate.ts (which projects COST burn against elapsed time) and capacity.ts (which is a
 * point-in-time supply/demand grid): this projects BACKLOG clearance against velocity. Velocity is supplied
 * directly — a caller can derive it from capacity.ts supply or from historical throughput; keeping it an input
 * keeps the engine vendor-neutral and pure.
 *
 * Every divide guards its denominator: a velocity ≤ 0 can never clear the backlog, so its forecast is `null`
 * (never Infinity). Whole sprints/PIs are ceilinged (a partially-needed sprint still consumes a whole sprint).
 * Pure, no I/O; deterministic (no Math.random). Validation first: backlog + velocities coerced via numLoose,
 * backlog + sprintsPerPi clamped to sane floors. An empty backlog ⇒ zero sprints (already done).
 */
import { numLoose, round2 } from "./num";

export interface PiForecastInput {
  /** Remaining backlog size (story points / effort units). Coerced; negative clamps to 0. */
  backlog: number;
  /** Expected ("likely") throughput cleared per sprint. */
  velocity: number;
  /** Optimistic (faster) per-sprint throughput. Defaults to `velocity`. */
  optimisticVelocity?: number;
  /** Pessimistic (slower) per-sprint throughput. Defaults to `velocity`. */
  pessimisticVelocity?: number;
  /** Sprints per Program Increment (a PI groups N sprints). Coerced; clamped to ≥ 1. Default 1. */
  sprintsPerPi?: number;
}

export interface VelocityForecast {
  /** The per-sprint velocity used for this scenario (coerced). */
  velocity: number;
  /** Whole sprints to clear the backlog = ceil(backlog / velocity). `null` when velocity ≤ 0 (never clears). */
  sprints: number | null;
  /** Whole PIs = ceil(sprints / sprintsPerPi). `null` when velocity ≤ 0. */
  pis: number | null;
}

export interface PiForecastResult {
  backlog: number;
  sprintsPerPi: number;
  /** Forecast at the likely velocity. */
  likely: VelocityForecast;
  /** Forecast at the optimistic (faster) velocity — the fewest sprints. */
  optimistic: VelocityForecast;
  /** Forecast at the pessimistic (slower) velocity — the most sprints. */
  pessimistic: VelocityForecast;
  /** True when even the pessimistic case clears the backlog in finite time (its velocity > 0). */
  feasible: boolean;
}

/** Forecast the sprints + PIs to clear `backlog` at `velocity`. Velocity ≤ 0 ⇒ null (never clears). */
function forecastAt(backlog: number, velocity: number, sprintsPerPi: number): VelocityForecast {
  if (velocity <= 0) return { velocity: round2(velocity), sprints: null, pis: null };
  const sprints = Math.ceil(backlog / velocity); // backlog 0 ⇒ 0 sprints (already done)
  return { velocity: round2(velocity), sprints, pis: Math.ceil(sprints / sprintsPerPi) };
}

/**
 * Forecast how many sprints and PIs a backlog needs at optimistic / likely / pessimistic velocities. Optimistic
 * and pessimistic default to the likely velocity when unspecified. Empty backlog ⇒ zero sprints across the board.
 */
export function forecastPi(input: PiForecastInput): PiForecastResult {
  const backlog = Math.max(0, numLoose(input.backlog));
  const likelyV = numLoose(input.velocity);
  const optimisticV = input.optimisticVelocity === undefined ? likelyV : numLoose(input.optimisticVelocity);
  const pessimisticV = input.pessimisticVelocity === undefined ? likelyV : numLoose(input.pessimisticVelocity);
  const sprintsPerPi = Math.max(1, Math.round(numLoose(input.sprintsPerPi ?? 1)));

  const pessimistic = forecastAt(backlog, pessimisticV, sprintsPerPi);

  return {
    backlog: round2(backlog),
    sprintsPerPi,
    likely: forecastAt(backlog, likelyV, sprintsPerPi),
    optimistic: forecastAt(backlog, optimisticV, sprintsPerPi),
    pessimistic,
    feasible: pessimistic.sprints !== null,
  };
}
