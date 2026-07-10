/**
 * Portfolio OPTIMISER — pick the project mix that maximises portfolio value under budget (and optional
 * capacity) constraints. This is the step beyond `autoFundByRank` (funding-scenario.ts): rank-greedy
 * is provably sub-optimal for the 0/1 knapsack it's really solving (a cheap mid-rank project can buy
 * more value than a costly top-rank one), so this module computes the genuinely-optimal selection —
 * the "efficient frontier" capability the top-tier PPM suites (Planview, Planisware) lead on.
 *
 * STATELESS + pure: it optimises over the scored projects the portfolio already produced
 * (portfolio-priority.ts) and returns a selection + the value/cost curve; nothing is stored.
 *
 * Algorithm: an EXACT dynamic-programming knapsack on budget (cost scaled to integer £k), which also
 * yields the whole efficient frontier for free. When a capacity cap is also set we extend to a 2-D DP
 * (budget × capacity buckets) while the grid stays tractable, and otherwise fall back to a
 * density-greedy + local-search pass that still beats plain rank-greedy (and we say which ran, so a
 * bounded result is never mistaken for exact).
 */

/** One candidate project: its value (composite score) and the two resources it consumes. */
export interface OptItem {
  id: string;
  name: string;
  /** Portfolio value bought by funding it (compositeScore); items with ≤0 value are only funded if must-fund. */
  value: number;
  cost: number;
  capacityHours: number;
}

export interface OptimiseOptions {
  /** Max funded cost. null ⇒ uncapped (fund everything with positive value). */
  budgetCap: number | null;
  /** Max funded capacity hours. null ⇒ not a constraint. */
  capacityCap?: number | null;
  /** Project ids that MUST be funded (mandates/commitments) — forced in, their cost/capacity pre-charged. */
  mustFund?: readonly string[];
  /** Project ids that must NOT be funded (governance forbid). */
  forbid?: readonly string[];
  /** Cost bucket size for the DP (£k). Larger = coarser but faster. Default 1. */
  costGranularity?: number;
}

export interface OptimiseResult {
  /** The optimal (or best-found) selected project ids. */
  selected: string[];
  totalValue: number;
  totalCost: number;
  totalCapacity: number;
  /** "exact" DP, or "heuristic" when the grid was too large for an exact capacity DP. */
  method: "exact" | "heuristic";
  /** What plain rank/density-greedy would have bought — so the UI can show the optimiser's uplift. */
  greedyValue: number;
  /** The efficient frontier: max achievable value at each budget level (for the value-vs-budget curve). */
  frontier: { budget: number; value: number }[];
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Exact 1-D knapsack on budget. Returns the optimal selected indices + the frontier over budget. */
function knapsackByBudget(
  items: OptItem[],
  budgetCapK: number,
  granularityK: number,
): { chosen: number[]; frontier: { budget: number; value: number }[] } {
  const W = Math.max(0, Math.floor(budgetCapK / granularityK));
  const weights = items.map((it) => Math.max(0, Math.ceil(it.cost / 1000 / granularityK)));
  const values = items.map((it) => it.value);
  // dp[w] = best value using budget ≤ w; keep[i][w] = was item i taken to reach dp[w] at stage i.
  const dp = new Array<number>(W + 1).fill(0);
  const keep: boolean[][] = [];
  for (let i = 0; i < items.length; i++) {
    const wi = weights[i]!;
    const vi = values[i]!;
    const row = new Array<boolean>(W + 1).fill(false);
    // Only positive-value items help a value-maximising knapsack.
    if (vi > 0) {
      for (let w = W; w >= wi; w--) {
        if (dp[w - wi]! + vi > dp[w]!) {
          dp[w] = dp[w - wi]! + vi;
          row[w] = true;
        }
      }
    }
    keep.push(row);
  }
  // Reconstruct the selection at the full cap.
  const chosen: number[] = [];
  let w = W;
  for (let i = items.length - 1; i >= 0; i--) {
    if (keep[i]![w]) {
      chosen.push(i);
      w -= weights[i]!;
    }
  }
  const frontier = dp.map((value, wi) => ({ budget: wi * granularityK * 1000, value }));
  return { chosen: chosen.reverse(), frontier };
}

/** Density-greedy + swap local search under both caps — the fallback; always ≥ plain greedy. */
function greedyWithSwaps(items: OptItem[], budgetCap: number, capacityCap: number): number[] {
  const feasible = (ids: Set<number>): boolean =>
    sum([...ids].map((i) => items[i]!.cost)) <= budgetCap && sum([...ids].map((i) => items[i]!.capacityHours)) <= capacityCap;
  const density = (i: number): number => (items[i]!.cost > 0 ? items[i]!.value / items[i]!.cost : items[i]!.value > 0 ? Infinity : -1);
  const order = items.map((_, i) => i).filter((i) => items[i]!.value > 0).sort((a, b) => density(b) - density(a));
  const sel = new Set<number>();
  for (const i of order) {
    sel.add(i);
    if (!feasible(sel)) sel.delete(i);
  }
  // Local search: try swapping one selected for one unselected that raises total value while staying feasible.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 10_000) {
    improved = false;
    for (const out of [...sel]) {
      for (const inx of order) {
        if (sel.has(inx)) continue;
        if (items[inx]!.value <= items[out]!.value) continue;
        const trial = new Set(sel);
        trial.delete(out);
        trial.add(inx);
        if (feasible(trial)) {
          sel.clear();
          for (const x of trial) sel.add(x);
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return [...sel];
}

/** Plain rank/density greedy value (the baseline the optimiser is measured against). */
function greedyValue(items: OptItem[], budgetCap: number, capacityCap: number): number {
  const density = (i: number): number => (items[i]!.cost > 0 ? items[i]!.value / items[i]!.cost : Infinity);
  const order = items.map((_, i) => i).filter((i) => items[i]!.value > 0).sort((a, b) => density(b) - density(a));
  let cost = 0;
  let cap = 0;
  let value = 0;
  for (const i of order) {
    if (cost + items[i]!.cost <= budgetCap && cap + items[i]!.capacityHours <= capacityCap) {
      cost += items[i]!.cost;
      cap += items[i]!.capacityHours;
      value += items[i]!.value;
    }
  }
  return value;
}

/** The grid-cell budget for the exact 2-D capacity DP; above this we use the heuristic. */
const MAX_2D_CELLS = 4_000_000;

/**
 * Optimise the portfolio. Returns the value-maximising selection under the caps, the efficient
 * frontier, and the greedy baseline for comparison. Pure + deterministic.
 */
export function optimisePortfolio(all: readonly OptItem[], opts: OptimiseOptions): OptimiseResult {
  const forbid = new Set(opts.forbid ?? []);
  const must = new Set(opts.mustFund ?? []);
  const granularity = Math.max(1, opts.costGranularity ?? 1);

  // Pre-charge the must-fund set; optimise the rest within the remaining caps.
  const forced = all.filter((it) => must.has(it.id) && !forbid.has(it.id));
  const forcedCost = sum(forced.map((it) => it.cost));
  const forcedCap = sum(forced.map((it) => it.capacityHours));
  const forcedValue = sum(forced.map((it) => it.value));

  const candidates = all.filter((it) => !must.has(it.id) && !forbid.has(it.id));
  const budgetCap = opts.budgetCap;
  const capacityCap = opts.capacityCap ?? null;
  const remainingBudget = budgetCap == null ? Infinity : Math.max(0, budgetCap - forcedCost);
  const remainingCapacity = capacityCap == null ? Infinity : Math.max(0, capacityCap - forcedCap);

  // The efficient frontier: optimal candidate value at each budget level, computed exactly whenever
  // there's a finite budget to sweep (capacity aside — the curve answers "value vs budget"), lifted by
  // the pre-charged must-fund value so it reads as whole-portfolio.
  const frontierBudget = Number.isFinite(remainingBudget) ? remainingBudget : sum(candidates.map((c) => c.cost));
  const frontier = knapsackByBudget(candidates, frontierBudget / 1000, granularity).frontier.map((p) => ({
    budget: p.budget + forcedCost,
    value: round1(p.value + forcedValue),
  }));

  let picked: OptItem[];
  let method: "exact" | "heuristic" = "exact";

  if (!Number.isFinite(remainingBudget)) {
    // Uncapped budget: fund every positive-value candidate (capacity-feasible if capped).
    picked = capacityCap == null
      ? candidates.filter((it) => it.value > 0)
      : greedyWithSwaps(candidates, Infinity, remainingCapacity).map((i) => candidates[i]!);
    if (capacityCap != null) method = "heuristic";
  } else if (capacityCap != null && Number.isFinite(remainingCapacity)) {
    // Two constraints: exact 2-D DP while the grid is tractable, else density-greedy + swaps.
    const W = Math.floor(remainingBudget / 1000 / granularity);
    const capBucket = Math.max(1, Math.ceil(remainingCapacity / 500));
    const C = Math.floor(remainingCapacity / capBucket);
    if ((W + 1) * (C + 1) <= MAX_2D_CELLS) {
      picked = knapsack2D(candidates, W, C, granularity, capBucket).map((i) => candidates[i]!);
    } else {
      picked = greedyWithSwaps(candidates, remainingBudget, remainingCapacity).map((i) => candidates[i]!);
      method = "heuristic";
    }
  } else {
    // Budget-only: exact 1-D knapsack (budget passed in £k).
    picked = knapsackByBudget(candidates, remainingBudget / 1000, granularity).chosen.map((i) => candidates[i]!);
  }

  const sel = [...forced, ...picked];
  const gBudget = budgetCap ?? Infinity;
  const gCap = capacityCap ?? Infinity;
  return {
    selected: sel.map((it) => it.id),
    totalValue: round1(sum(sel.map((it) => it.value))),
    totalCost: round1(sum(sel.map((it) => it.cost))),
    totalCapacity: round1(sum(sel.map((it) => it.capacityHours))),
    method,
    greedyValue: round1(greedyValue(all.filter((it) => !forbid.has(it.id)), gBudget, gCap)),
    frontier,
  };
}

/** Exact 2-D DP over budget (£k) × capacity buckets. Returns selected candidate indices. */
function knapsack2D(items: OptItem[], W: number, C: number, granK: number, capBucket: number): number[] {
  const wcost = items.map((it) => Math.max(0, Math.ceil(it.cost / 1000 / granK)));
  const wcap = items.map((it) => Math.max(0, Math.ceil(it.capacityHours / capBucket)));
  const vals = items.map((it) => it.value);
  // dp as flat (W+1)*(C+1); keep per-item taken flags for reconstruction.
  const size = (W + 1) * (C + 1);
  let dp = new Float64Array(size);
  const keep: Uint8Array[] = [];
  const idx = (w: number, c: number): number => w * (C + 1) + c;
  for (let i = 0; i < items.length; i++) {
    const ci = wcost[i]!;
    const pi = wcap[i]!;
    const vi = vals[i]!;
    const row = new Uint8Array(size);
    if (vi > 0) {
      const next = dp.slice();
      for (let w = W; w >= ci; w--) {
        for (let c = C; c >= pi; c--) {
          const cand = dp[idx(w - ci, c - pi)]! + vi;
          if (cand > dp[idx(w, c)]!) {
            next[idx(w, c)] = cand;
            row[idx(w, c)] = 1;
          }
        }
      }
      dp = next;
    }
    keep.push(row);
  }
  const chosen: number[] = [];
  let w = W;
  let c = C;
  for (let i = items.length - 1; i >= 0; i--) {
    if (keep[i]![idx(w, c)]) {
      chosen.push(i);
      w -= wcost[i]!;
      c -= wcap[i]!;
    }
  }
  return chosen.reverse();
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
