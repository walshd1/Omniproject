/**
 * FUNDING-ENVELOPE / SCENARIO ENGINE — does an approved funding envelope actually cover what's committed
 * plus what's still forecast, and where does it run out?
 *
 * The scheduler answers "when", EVM answers "how are we doing against the baselined plan", run-rate answers
 * "will we land on budget at this burn". This is the portfolio-decisioning sibling: hold a fixed envelope
 * (approved funding for an initiative / portfolio bucket) against what is already COMMITTED and what is still
 * FORECAST to spend, and read the headroom, the over-commitment, and the fraction of the plan the envelope
 * covers — the input a fund/defer/cut scenario needs.
 *
 * Definitions (all money in one unit; fractions in [0, 1]):
 *   headroom             = envelope − committed − forecast        — +slack / −over-committed at completion
 *   projectedTotal       = committed + forecast                   — the plan's full draw on the envelope
 *   overCommitted        = projectedTotal > envelope              — the plan already exceeds the funding
 *   burnThroughFraction  = envelope / projectedTotal, clamped [0,1]— the fraction of the plan the envelope
 *                          funds; < 1 means the money runs out before the plan completes (null if nothing is
 *                          planned yet, projectedTotal = 0)
 *   headroom/committed/forecastPct = each ÷ envelope              — null when the envelope is 0
 * Optional pacing (only when `elapsedFraction` is supplied, clamped to [0, 1]):
 *   expectedCommitted    = envelope × elapsedFraction             — straight-line expected commit by now
 *   paceVariance         = committed − expectedCommitted          — +committing faster than the clock / −slower
 *
 * Every divide guards its denominator and returns `null` when undefined — never NaN/±Infinity. Inputs are
 * coerced to finite numbers first (a dirty read can't poison a sum). Ratios come from RAW inputs; only the
 * returned scalars are rounded (money to cents, fractions to 4 dp), same discipline as run-rate.ts / evm.ts.
 * Pure, no I/O.
 */
import { num, round2, clamp } from "./num";

/** Round to 4 decimal places (fractions / ratios). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A guarded ratio: `null` when the denominator is 0 (never NaN/±Infinity). */
const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

/** A guarded ratio rounded to 4 dp (fraction), or `null` when the denominator is 0. */
const ratioRounded = (numerator: number, denominator: number): number | null => {
  const r = ratio(numerator, denominator);
  return r === null ? null : round4(r);
};

export interface FundingInput {
  /** Approved funding envelope for the scope (money). */
  envelope: number;
  /** Spend already committed (contracted / PO'd / booked). */
  committed: number;
  /** Projected remaining spend still to come (forecast to complete). */
  forecast: number;
  /**
   * Optional: how far through the funding window you are, a fraction in [0, 1] (values outside are clamped).
   * When supplied, enables the straight-line commit-pacing outputs; when absent they are `null`.
   */
  elapsedFraction?: number;
}

export interface FundingResult {
  envelope: number;
  committed: number;
  forecast: number;
  /** committed + forecast — the plan's full draw on the envelope. */
  projectedTotal: number;
  /** envelope − committed − forecast (+ slack / − over-committed). */
  headroom: number;
  /** headroom / envelope, signed. `null` when the envelope is 0. */
  headroomPct: number | null;
  /** committed / envelope. `null` when the envelope is 0. */
  committedPct: number | null;
  /** forecast / envelope. `null` when the envelope is 0. */
  forecastPct: number | null;
  /** Whether the plan (committed + forecast) already exceeds the envelope. */
  overCommitted: boolean;
  /**
   * envelope / projectedTotal, clamped to [0, 1] — the fraction of the plan the envelope funds. `null` when
   * nothing is planned yet (projectedTotal = 0). < 1 marks where the money runs out before the plan completes.
   */
  burnThroughFraction: number | null;
  /** The clamped elapsed fraction actually used, or `null` when none was supplied. */
  elapsedFraction: number | null;
  /** envelope × elapsedFraction — straight-line expected commit by now. `null` when no elapsed fraction. */
  expectedCommitted: number | null;
  /** committed − expectedCommitted (+ ahead of pace / − behind). `null` when no elapsed fraction. */
  paceVariance: number | null;
}

/**
 * Read an envelope against its committed + forecast draw. Inputs are coerced to finite numbers; the envelope
 * percentages are `null` when the envelope is 0, and the burn-through fraction is `null` when nothing is
 * planned. When `elapsedFraction` is supplied it is clamped to [0, 1] and the pacing outputs are computed;
 * otherwise they are `null`.
 */
export function computeFunding(input: FundingInput): FundingResult {
  const envelope = num(input.envelope);
  const committed = num(input.committed);
  const forecast = num(input.forecast);
  const hasElapsed = input.elapsedFraction !== undefined && input.elapsedFraction !== null;
  const elapsedFraction = hasElapsed ? clamp(num(input.elapsedFraction), 0, 1) : null;

  const projectedTotal = committed + forecast;
  const headroom = envelope - committed - forecast;
  const burnRaw = ratio(envelope, projectedTotal);
  const expectedCommittedRaw = elapsedFraction === null ? null : envelope * elapsedFraction;

  return {
    envelope: round2(envelope),
    committed: round2(committed),
    forecast: round2(forecast),
    projectedTotal: round2(projectedTotal),
    headroom: round2(headroom),
    headroomPct: ratioRounded(headroom, envelope),
    committedPct: ratioRounded(committed, envelope),
    forecastPct: ratioRounded(forecast, envelope),
    overCommitted: projectedTotal > envelope,
    burnThroughFraction: burnRaw === null ? null : round4(clamp(burnRaw, 0, 1)),
    elapsedFraction: elapsedFraction === null ? null : round4(elapsedFraction),
    expectedCommitted: expectedCommittedRaw === null ? null : round2(expectedCommittedRaw),
    paceVariance: expectedCommittedRaw === null ? null : round2(committed - expectedCommittedRaw),
  };
}

export interface FundingRollupResult {
  /** How many envelopes were rolled up. */
  count: number;
  envelope: number;
  committed: number;
  forecast: number;
  projectedTotal: number;
  headroom: number;
  /** headroom / total envelope. `null` when the summed envelope is 0. */
  headroomPct: number | null;
  /** Whether the summed plan exceeds the summed envelope. */
  overCommitted: boolean;
  /** total envelope / total projected, clamped [0, 1]. `null` when nothing is planned across the set. */
  burnThroughFraction: number | null;
}

/**
 * Roll a set of envelopes into one portfolio-scale envelope: sum the envelope / committed / forecast, then
 * recompute headroom, over-commitment and burn-through at scale from those RAW sums (rounding never compounds
 * through the fold). An empty set yields a zero count with zero money and null ratios.
 */
export function rollupFunding(inputs: readonly FundingInput[]): FundingRollupResult {
  let envelope = 0;
  let committed = 0;
  let forecast = 0;
  for (const input of inputs) {
    envelope += num(input.envelope);
    committed += num(input.committed);
    forecast += num(input.forecast);
  }
  const projectedTotal = committed + forecast;
  const headroom = envelope - committed - forecast;
  const burnRaw = ratio(envelope, projectedTotal);
  return {
    count: inputs.length,
    envelope: round2(envelope),
    committed: round2(committed),
    forecast: round2(forecast),
    projectedTotal: round2(projectedTotal),
    headroom: round2(headroom),
    headroomPct: ratioRounded(headroom, envelope),
    overCommitted: projectedTotal > envelope,
    burnThroughFraction: burnRaw === null ? null : round4(clamp(burnRaw, 0, 1)),
  };
}
