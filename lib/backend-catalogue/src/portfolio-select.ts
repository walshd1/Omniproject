/**
 * PORTFOLIO SELECTION / EFFICIENT-FRONTIER ENGINE — pick the highest-value subset of candidate initiatives
 * that fits a budget (and an optional capacity) cap. The capital-budgeting core behind a fund/defer/cut
 * decision.
 *
 * This is a 0/1 knapsack: each initiative is taken whole or not at all. The exact problem is NP-hard, so the
 * engine is HONEST about optimality and exposes two entry points:
 *
 *   • {@link selectByRatio} — the greedy value/cost ("bang-per-buck") HEURISTIC. Sort by value ÷ cost
 *     descending (stable tiebreak by id, so it is fully deterministic — no Math.random), take while the budget
 *     (and capacity, if capped) allow. Always terminates, O(n log n); NOT guaranteed optimal.
 *   • {@link selectOptimal} — the EXACT optimum via integer dynamic programming, but ONLY when it is provably
 *     bounded: non-negative INTEGER costs, an integer budget ≤ {@link EXACT_MAX_BUDGET}, no capacity cap
 *     (the 1-D DP covers the budget axis only), and a DP table of ≤ {@link EXACT_MAX_CELLS} cells. When any
 *     of those does not hold it falls back to {@link selectByRatio} and flags `exact: false`, so a caller can
 *     always tell whether the answer is proven optimal or a heuristic.
 *
 * VALIDATION FIRST: value/cost/capacity are coerced to finite numbers (a dirty read can't poison the sums);
 * costs and capacities are clamped to ≥ 0; a non-positive-value candidate is never selected. Every divide is
 * guarded (`budgetUsedPct` is null when the budget is 0). Pure, no I/O — same discipline as funding.ts /
 * run-rate.ts.
 */
import { num, round2 } from "./num";

/** Round to 4 decimal places (fractions / ratios). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** The largest integer budget the exact DP will run for (keeps the table bounded). */
export const EXACT_MAX_BUDGET = 100_000;
/** The largest DP table (candidates × (budget+1) cells) the exact solver will allocate before falling back. */
export const EXACT_MAX_CELLS = 5_000_000;

export interface Candidate {
  /** Stable identifier — also the deterministic tiebreak key. */
  id: string;
  /** The value/benefit of funding this initiative (higher is better; non-positive ⇒ never selected). */
  value: number;
  /** The budget cost of funding it (clamped to ≥ 0). */
  cost: number;
  /** Optional capacity/effort demand, checked against the optional capacity cap (clamped to ≥ 0). */
  capacity?: number;
}

export interface SelectionOptions {
  /** Optional capacity cap the selected set's total capacity demand must not exceed. */
  capacity?: number;
}

export interface SelectionResult {
  /** Selected candidate ids, in ascending-id order (deterministic). */
  selected: string[];
  /** Candidate ids not selected, in ascending-id order. */
  dropped: string[];
  /** Σ value of the selected set. */
  totalValue: number;
  /** Σ cost of the selected set. */
  totalCost: number;
  /** Σ capacity demand of the selected set, or `null` when no candidate carried capacity data. */
  totalCapacity: number | null;
  /** totalCost / budget, guarded. `null` when the budget is 0. */
  budgetUsedPct: number | null;
  /** True only when the exact DP produced this result; false for the greedy heuristic (incl. fallbacks). */
  exact: boolean;
}

/** A coerced candidate: finite value, cost/capacity clamped to ≥ 0; `hasCapacity` tracks whether any was given. */
interface Norm {
  id: string;
  value: number;
  cost: number;
  capacity: number;
  hasCapacity: boolean;
}

const clampMin0 = (n: number): number => (n > 0 ? n : 0);

/** Coerce + clamp the raw candidates once; the shared front door for both strategies. */
function normalize(candidates: readonly Candidate[]): Norm[] {
  return candidates.map((c) => {
    const hasCapacity = c.capacity !== undefined && c.capacity !== null;
    return { id: String(c.id), value: num(c.value), cost: clampMin0(num(c.cost)), capacity: hasCapacity ? clampMin0(num(c.capacity)) : 0, hasCapacity };
  });
}

/** Build the result from a chosen subset (by id), summing over the normalized candidates deterministically. */
function finalize(norm: readonly Norm[], chosen: ReadonlySet<string>, budget: number, exact: boolean): SelectionResult {
  let totalValue = 0, totalCost = 0, totalCapacity = 0;
  const anyCapacity = norm.some((n) => n.hasCapacity);
  const selected: string[] = [], dropped: string[] = [];
  for (const n of norm) {
    if (chosen.has(n.id)) { totalValue += n.value; totalCost += n.cost; totalCapacity += n.capacity; selected.push(n.id); }
    else dropped.push(n.id);
  }
  const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  selected.sort(byId);
  dropped.sort(byId);
  return {
    selected,
    dropped,
    totalValue: round2(totalValue),
    totalCost: round2(totalCost),
    totalCapacity: anyCapacity ? round2(totalCapacity) : null,
    budgetUsedPct: budget === 0 ? null : round4(totalCost / budget),
    exact,
  };
}

/**
 * Greedy value/cost selection — a deterministic heuristic, not guaranteed optimal. Candidates are ranked by
 * value ÷ cost (a zero-cost positive-value item ranks first; ties broken by id ascending) and taken while the
 * remaining budget — and, when `opts.capacity` is set, the remaining capacity — still admit them.
 */
export function selectByRatio(candidates: readonly Candidate[], budget: number, opts: SelectionOptions = {}): SelectionResult {
  const cap = clampMin0(num(budget));
  const hasCapCap = opts.capacity !== undefined && opts.capacity !== null;
  const capacityCap = hasCapCap ? clampMin0(num(opts.capacity)) : Infinity;
  const norm = normalize(candidates);

  const ranked = [...norm].sort((a, b) => {
    const ra = a.cost > 0 ? a.value / a.cost : (a.value > 0 ? Infinity : -Infinity);
    const rb = b.cost > 0 ? b.value / b.cost : (b.value > 0 ? Infinity : -Infinity);
    if (ra !== rb) return rb - ra; // higher bang-per-buck first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // deterministic tiebreak
  });

  let remainingBudget = cap, remainingCapacity = capacityCap;
  const chosen = new Set<string>();
  for (const n of ranked) {
    if (n.value <= 0) continue; // a non-positive-value initiative is never worth funding
    if (n.cost > remainingBudget) continue;
    if (n.capacity > remainingCapacity) continue;
    chosen.add(n.id);
    remainingBudget -= n.cost;
    remainingCapacity -= n.capacity;
  }
  return finalize(norm, chosen, cap, false);
}

/**
 * Exact optimum via 0/1-knapsack integer DP over the budget axis — used ONLY when it is provably bounded:
 * non-negative INTEGER costs, an integer budget ≤ {@link EXACT_MAX_BUDGET}, no capacity cap, and a table of
 * ≤ {@link EXACT_MAX_CELLS} cells. Otherwise it falls back to {@link selectByRatio} (flagged `exact: false`),
 * so the result is always bounded and deterministic.
 */
export function selectOptimal(candidates: readonly Candidate[], budget: number, opts: SelectionOptions = {}): SelectionResult {
  const cap = num(budget);
  const norm = normalize(candidates);
  const hasCapCap = opts.capacity !== undefined && opts.capacity !== null;

  const eligible =
    !hasCapCap && // a capacity cap needs a 2-D table — out of the exact solver's bounded scope
    Number.isInteger(cap) && cap >= 0 && cap <= EXACT_MAX_BUDGET &&
    norm.every((n) => Number.isInteger(n.cost)) &&
    norm.length * (cap + 1) <= EXACT_MAX_CELLS;
  if (!eligible) return selectByRatio(candidates, budget, opts);

  // dp[w] = best value achievable with budget w; take[i][w] = item i was included at stage i for budget w.
  const dp = new Array<number>(cap + 1).fill(0);
  const take: boolean[][] = norm.map(() => new Array<boolean>(cap + 1).fill(false));
  for (let i = 0; i < norm.length; i++) {
    const { cost, value } = norm[i]!;
    if (value <= 0) continue; // never improves the optimum — leave it dropped
    for (let w = cap; w >= cost; w--) {
      const candidate = dp[w - cost]! + value;
      if (candidate > dp[w]!) { dp[w] = candidate; take[i]![w] = true; }
    }
  }
  // Reconstruct the chosen set by walking the take table backward.
  const chosen = new Set<string>();
  let w = cap;
  for (let i = norm.length - 1; i >= 0; i--) {
    if (take[i]![w]) { chosen.add(norm[i]!.id); w -= norm[i]!.cost; }
  }
  return finalize(norm, chosen, cap, true);
}
