/**
 * SCENARIO / WHAT-IF COMPARISON ENGINE — rank N candidate investment scenarios on their financial return so a
 * fund/defer/cut decision can be made against the same yardstick (roadmap §4.3, "scenario / what-if portfolio
 * planning"). Each scenario is a stream of net cash flows over time; the engine computes the standard
 * discounted-cash-flow metrics and returns a deterministic ranked ordering.
 *
 * This is distinct from its Wave-4 siblings and deliberately does NOT duplicate them: funding.ts models a single
 * envelope's headroom, portfolio-select.ts picks a value-maximising SUBSET under a budget cap (0/1 knapsack), and
 * prioritise.ts scores individual initiatives by WSJF/RICE. This module compares WHOLE scenarios by return.
 *
 *   • {@link scoreScenario} — per scenario: NPV (discounted), ROI, benefit-cost ratio, and payback period.
 *   • {@link compareScenarios} — score every scenario and rank by NPV descending (deterministic id tiebreak).
 *
 * DCF conventions: cash flows are indexed from period 0 (period 0 is undiscounted — money now). A negative flow is
 * an outflow/cost, a positive flow an inflow/benefit. NPV / benefit-cost ratio discount at the given rate; ROI and
 * payback use undiscounted flows (documented per field). HONEST about undefined maths: ratios whose divisor is 0
 * (no outflow) are `null`, never Infinity; a scenario that never recovers its outflow has a `null` payback period;
 * a null primary metric (NPV is always finite here) would sort last. VALIDATION FIRST: every input is coerced to a
 * finite number via num() (a dirty read can't produce NaN); a discount rate ≤ -100% (a non-positive growth base)
 * falls back to undiscounted so the power series can't divide by zero or flip sign. Pure, no I/O — same discipline
 * as funding.ts / prioritise.ts.
 */
import { num, numLoose, round2 } from "./num";

/** Round to 4 decimal places (ratios). */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A stable ascending-id comparator — the deterministic tiebreak (no Math.random). */
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface Scenario {
  /** Stable identifier — also the deterministic tiebreak key. */
  id: string;
  /**
   * Net cash flow per period, period 0 first: negative = outflow/cost, positive = inflow/benefit. When absent it
   * is derived from `cost` (a period-0 outflow) followed by `benefits` (one inflow per subsequent period).
   */
  cashFlows?: number[];
  /** Convenience input: a single upfront cost booked at period 0 (used only when `cashFlows` is not given). */
  cost?: number;
  /** Convenience input: the benefit inflow(s) in the periods after period 0 (used only when `cashFlows` is absent). */
  benefits?: number[];
}

export interface CompareOptions {
  /** Per-period discount rate as a fraction (0.1 = 10%). Coerced to a finite number; ≤ -1 falls back to 0. */
  discountRate?: number;
}

export interface ScenarioScore {
  id: string;
  /** Net present value: Σ cashFlow_t / (1 + rate)^t, period 0 undiscounted. Always finite. */
  npv: number;
  /** Present value of the positive flows (discounted inflows). */
  pvInflows: number;
  /** Present value of the |negative| flows (discounted outflows). */
  pvOutflows: number;
  /** (Σ inflow − Σ outflow) / Σ outflow, UNDISCOUNTED, or `null` when there is no outflow. */
  roi: number | null;
  /** pvInflows / pvOutflows (discounted benefit-cost ratio), or `null` when there is no outflow. */
  benefitCostRatio: number | null;
  /** First period index at which cumulative UNDISCOUNTED cash flow turns non-negative, or `null` if it never does. */
  paybackPeriod: number | null;
}

/** Resolve a scenario's net cash-flow series: the explicit `cashFlows`, else `[-cost, ...benefits]`. */
function resolveCashFlows(s: Scenario): number[] {
  if (Array.isArray(s.cashFlows)) return s.cashFlows.map(numLoose);
  const flows: number[] = [-Math.abs(numLoose(s.cost))]; // a cost is always an outflow at period 0
  if (Array.isArray(s.benefits)) for (const b of s.benefits) flows.push(numLoose(b));
  return flows;
}

/**
 * Score one scenario. NPV and the benefit-cost ratio discount at `rate`; ROI and payback use undiscounted flows.
 * Every divide is guarded — a scenario with no outflow yields `roi`/`benefitCostRatio` of `null` (never Infinity),
 * and one that never recovers its cost yields a `null` payback period.
 */
export function scoreScenario(s: Scenario, rate: number): ScenarioScore {
  const flows = resolveCashFlows(s);
  // A growth base ≤ 0 (rate ≤ -100%) makes the discount power series divide by zero / flip sign — fall back to
  // undiscounted, which is the sane interpretation of a nonsensical rate.
  const base = 1 + rate;
  const safeBase = base > 0 ? base : 1;

  let pvInflows = 0, pvOutflows = 0, cumulative = 0;
  let paybackPeriod: number | null = null;
  for (let t = 0; t < flows.length; t++) {
    const flow = flows[t]!;
    const pv = flow / safeBase ** t; // period 0 ⇒ safeBase**0 = 1 (undiscounted)
    if (flow >= 0) pvInflows += pv; else pvOutflows += -pv;
    cumulative += flow; // undiscounted running total for payback
    if (paybackPeriod === null && cumulative >= 0) paybackPeriod = t;
  }

  const npv = pvInflows - pvOutflows;
  const undiscountedIn = flows.reduce((sum, f) => (f > 0 ? sum + f : sum), 0);
  const undiscountedOut = flows.reduce((sum, f) => (f < 0 ? sum - f : sum), 0);

  return {
    id: String(s.id),
    npv: round2(npv),
    pvInflows: round2(pvInflows),
    pvOutflows: round2(pvOutflows),
    roi: undiscountedOut > 0 ? round4((undiscountedIn - undiscountedOut) / undiscountedOut) : null,
    benefitCostRatio: pvOutflows > 0 ? round4(pvInflows / pvOutflows) : null,
    paybackPeriod,
  };
}

export interface ScenarioComparison {
  /** Every scenario scored, ordered by NPV descending (equal NPV broken by id ascending). */
  ranked: ScenarioScore[];
}

/**
 * Score and rank a set of scenarios by NPV (the primary fund/defer/cut yardstick). Empty input ⇒ empty ranking.
 * The discount rate is coerced to a finite number and clamped to a sane growth base (see {@link scoreScenario}).
 */
export function compareScenarios(scenarios: readonly Scenario[], opts: CompareOptions = {}): ScenarioComparison {
  const rate = num(opts.discountRate);
  const scored = scenarios.map((s) => scoreScenario(s, rate));
  scored.sort((a, b) => (a.npv !== b.npv ? b.npv - a.npv : byId(a.id, b.id)));
  return { ranked: scored };
}
