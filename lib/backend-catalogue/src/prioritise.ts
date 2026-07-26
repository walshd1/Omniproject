/**
 * PORTFOLIO PRIORITISATION ENGINE — the two standard "which do we do first?" scoring models, computed
 * per initiative and returned as a deterministic ranked ordering. This is the raw per-item scoring maths;
 * the composite blend weights (how much RICE vs WSJF vs MoSCoW etc. count toward one number) live
 * separately as {@link PriorityWeights} in ./priority-weights — that module owns the WEIGHTING shape, this
 * one owns the SCORES it weighs. Kept apart so neither duplicates the other.
 *
 *   • {@link scoreWSJF} / {@link prioritiseWSJF} — Weighted Shortest Job First = cost-of-delay ÷ job-size.
 *     Cost-of-delay is either supplied directly (`costOfDelay`) or summed from the SAFe components
 *     (user-value + time-criticality + risk-reduction/opportunity-enablement). Higher score first.
 *   • {@link scoreRICE} / {@link prioritiseRICE} — Reach × Impact × Confidence ÷ Effort. Confidence is a
 *     0..1 multiplier (a 1..100 percentage is coerced to its fraction). Higher score first.
 *
 * HONEST about undefined maths: the divisor of each model (job-size for WSJF, effort for RICE) must be
 * strictly positive — when it is ≤ 0 the score is `null` (NOT Infinity), and a null-scored item always
 * sorts LAST in the ranking rather than poisoning the order. VALIDATION FIRST: every numeric input is
 * coerced to a finite number (a dirty read can't produce NaN), the divide is guarded, and an empty input
 * yields an empty ranking. Pure, no I/O — same discipline as funding.ts / portfolio-select.ts.
 */
import { num } from "./num";

/** Round to 4 decimal places (scores / ratios). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A stable ascending-id comparator — the deterministic tiebreak shared by both rankings (no Math.random). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Order scored items: higher score first, a `null` score always last, and equal scores broken by id
 * ascending so the ordering is fully deterministic for identical input.
 */
function rankByScore<T extends { id: string; score: number | null }>(scored: readonly T[]): T[] {
  return [...scored].sort((a, b) => {
    if (a.score === null && b.score === null) return byId(a.id, b.id);
    if (a.score === null) return 1; // nulls sink to the bottom
    if (b.score === null) return -1;
    if (a.score !== b.score) return b.score - a.score; // higher score first
    return byId(a.id, b.id);
  });
}

// ─────────────────────────────────────────── WSJF ───────────────────────────────────────────

export interface WsjfItem {
  /** Stable identifier — also the deterministic tiebreak key. */
  id: string;
  /** Cost of delay, supplied directly. When absent, it is summed from the three SAFe components below. */
  costOfDelay?: number;
  /** SAFe cost-of-delay component: business/user value. Used only when `costOfDelay` is not given. */
  userValue?: number;
  /** SAFe cost-of-delay component: time criticality. Used only when `costOfDelay` is not given. */
  timeCriticality?: number;
  /** SAFe cost-of-delay component: risk reduction / opportunity enablement. Used only when `costOfDelay` is not given. */
  riskOpportunity?: number;
  /** Job size / effort proxy — the divisor. Must be > 0 for a finite score. */
  jobSize?: number;
}

export interface WsjfScore {
  id: string;
  /** The resolved cost of delay (direct, or the sum of the three components). */
  costOfDelay: number;
  /** The job size used as the divisor. */
  jobSize: number;
  /** costOfDelay ÷ jobSize, or `null` when jobSize ≤ 0 (undefined — never Infinity). */
  score: number | null;
}

/** Resolve cost-of-delay: the direct field when given, else the sum of the three SAFe components. */
function resolveCostOfDelay(item: WsjfItem): number {
  if (item.costOfDelay !== undefined && item.costOfDelay !== null) return num(item.costOfDelay);
  return num(item.userValue) + num(item.timeCriticality) + num(item.riskOpportunity);
}

/**
 * Score one initiative by WSJF = cost-of-delay ÷ job-size. The divide is guarded: a job size of 0 (or
 * negative, or missing) yields `score: null` rather than Infinity/NaN.
 */
export function scoreWSJF(item: WsjfItem): WsjfScore {
  const costOfDelay = resolveCostOfDelay(item);
  const jobSize = num(item.jobSize);
  const score = jobSize > 0 ? round4(costOfDelay / jobSize) : null;
  return { id: String(item.id), costOfDelay, jobSize, score };
}

export interface WsjfRanking {
  /** Every item scored, ordered highest WSJF first (null scores last, id-ascending tiebreak). */
  ranked: WsjfScore[];
}

/** Score and rank a set of initiatives by WSJF. Empty input ⇒ empty ranking. */
export function prioritiseWSJF(items: readonly WsjfItem[]): WsjfRanking {
  return { ranked: rankByScore(items.map(scoreWSJF)) };
}

// ─────────────────────────────────────────── RICE ───────────────────────────────────────────

export interface RiceItem {
  /** Stable identifier — also the deterministic tiebreak key. */
  id: string;
  /** Reach — how many are affected in a period. */
  reach?: number;
  /** Impact — the per-reach effect (any finite number; typically a discrete 0.25..3 scale). */
  impact?: number;
  /** Confidence — a 0..1 multiplier. A 1..100 value is read as a percentage and coerced to its fraction. */
  confidence?: number;
  /** Effort — the divisor (person-time). Must be > 0 for a finite score. */
  effort?: number;
}

export interface RiceScore {
  id: string;
  reach: number;
  impact: number;
  /** The confidence multiplier actually applied (0..1) after percentage coercion + clamping. */
  confidence: number;
  effort: number;
  /** reach × impact × confidence ÷ effort, or `null` when effort ≤ 0 (undefined — never Infinity). */
  score: number | null;
}

/**
 * Coerce a confidence input to a 0..1 multiplier. A value in (1, 100] is read as a percentage (80 ⇒ 0.8);
 * anything ≤ 0 clamps to 0 and anything above 100 (or above 1 once treated as a fraction) clamps to 1.
 */
function coerceConfidence(raw: number | null | undefined): number {
  const c = num(raw);
  if (c <= 0) return 0;
  const fraction = c > 1 ? c / 100 : c; // >1 means it was given as a percentage
  return fraction > 1 ? 1 : fraction; // e.g. 150(%) ⇒ 1.5 ⇒ clamp to 1
}

/**
 * Score one initiative by RICE = reach × impact × confidence ÷ effort. The divide is guarded: an effort of
 * 0 (or negative, or missing) yields `score: null` rather than Infinity/NaN.
 */
export function scoreRICE(item: RiceItem): RiceScore {
  const reach = num(item.reach);
  const impact = num(item.impact);
  const confidence = coerceConfidence(item.confidence);
  const effort = num(item.effort);
  const score = effort > 0 ? round4((reach * impact * confidence) / effort) : null;
  return { id: String(item.id), reach, impact, confidence, effort, score };
}

export interface RiceRanking {
  /** Every item scored, ordered highest RICE first (null scores last, id-ascending tiebreak). */
  ranked: RiceScore[];
}

/** Score and rank a set of initiatives by RICE. Empty input ⇒ empty ranking. */
export function prioritiseRICE(items: readonly RiceItem[]): RiceRanking {
  return { ranked: rankByScore(items.map(scoreRICE)) };
}
