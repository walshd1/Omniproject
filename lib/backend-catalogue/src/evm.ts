/**
 * EARNED VALUE MANAGEMENT (EVM) ENGINE — the pure computation the EVM field vocabulary earns.
 *
 * fields.json carries the EVM PRIMITIVES (planned value PV, earned value EV, actual cost AC, budget at
 * completion BAC) and the DERIVED scalars (CV, SV, CPI, SPI, EAC, ETC, VAC, TCPI) as field keys — but nothing
 * computes the derived set; today they're read straight off the source read-model, so a backend that supplies
 * only PV/EV/AC/BAC yields no variances or forecast. This module is that computation: a pure, dependency-light
 * library (the same home + shape as depreciation / consolidation / num) that takes the four primitives and
 * returns the full EVM picture. No I/O.
 *
 * Formulas (PMBOK):
 *   CV  = EV − AC            SV  = EV − PV
 *   CPI = EV / AC            SPI = EV / PV
 *   % complete = EV / BAC    % spent = AC / BAC
 *   EAC — four methods (pick via `eacMethod`, default "cpi"):
 *     · cpi         BAC / CPI                       — current cost performance continues (typical)
 *     · budget_rate AC + (BAC − EV)                — remaining work at the budgeted rate (variance was one-off)
 *     · cpi_spi     AC + (BAC − EV) / (CPI × SPI)  — remaining work weighted by cost AND schedule performance
 *     · etc         AC + ETC                        — a bottom-up estimate-to-complete supplied by the caller
 *   ETC  = EAC − AC          VAC  = BAC − EAC
 *   TCPI(to BAC) = (BAC − EV) / (BAC − AC)   TCPI(to EAC) = (BAC − EV) / (EAC − AC)
 *
 * Every ratio guards its denominator and returns `null` when it is undefined (e.g. CPI before any cost is
 * booked), never NaN/Infinity — a caller renders `null` as "—", not a bogus number. Ratios are computed from
 * RAW inputs (never from already-rounded intermediates); only the returned scalars are rounded (currency to
 * cents, indices to 3 dp) so displayed numbers are stable without compounding rounding error.
 */
import { round2 } from "./num";

/** The EAC formula that drives the headline `estimateAtCompletion` / `varianceAtCompletion` / `estimateToComplete`. */
export type EacMethod = "cpi" | "budget_rate" | "cpi_spi" | "etc";

export interface EvmInputs {
  /** Planned value (PV / BCWS) — the budgeted cost of work scheduled by the status date. */
  plannedValue: number;
  /** Earned value (EV / BCWP) — the budgeted cost of work actually performed. */
  earnedValue: number;
  /** Actual cost (AC / ACWP) — what the performed work actually cost. */
  actualCost: number;
  /** Budget at completion (BAC) — the total approved budget for the work. */
  budgetAtCompletion: number;
  /** Optional bottom-up estimate-to-complete; required for (and only used by) the "etc" EAC method. */
  estimateToComplete?: number;
  /** Which EAC formula is the headline forecast. Default "cpi" (the most common). */
  eacMethod?: EacMethod;
}

export interface EvmResult {
  plannedValue: number;
  earnedValue: number;
  actualCost: number;
  budgetAtCompletion: number;
  /** CV = EV − AC. Positive = under budget. */
  costVariance: number;
  /** SV = EV − PV. Positive = ahead of schedule. */
  scheduleVariance: number;
  /** CV / EV. */
  costVariancePct: number | null;
  /** SV / PV. */
  scheduleVariancePct: number | null;
  /** CPI = EV / AC. < 1 = over budget. */
  costPerformanceIndex: number | null;
  /** SPI = EV / PV. < 1 = behind schedule. */
  schedulePerformanceIndex: number | null;
  /** EV / BAC. */
  percentComplete: number | null;
  /** AC / BAC. */
  percentSpent: number | null;
  /** The EAC formula used for the headline forecast fields. */
  eacMethod: EacMethod;
  /** Headline EAC per {@link EacMethod}. */
  estimateAtCompletion: number | null;
  /** ETC = EAC − AC (from the headline EAC). */
  estimateToComplete: number | null;
  /** VAC = BAC − EAC (from the headline EAC). Positive = expected to come in under budget. */
  varianceAtCompletion: number | null;
  /** TCPI to finish within BAC = (BAC − EV) / (BAC − AC). */
  toCompletePerformanceIndex: number | null;
  /** TCPI to finish within the headline EAC = (BAC − EV) / (EAC − AC). */
  toCompletePerformanceIndexToEac: number | null;
  /** Every EAC variant, for side-by-side comparison. */
  eacVariants: { cpi: number | null; budgetRate: number | null; cpiSpi: number | null; etc: number | null };
}

/** a / b, or null when b is 0 or the result isn't finite. */
const ratio = (a: number, b: number): number | null => (b !== 0 && Number.isFinite(a / b) ? a / b : null);
/** Round an index/ratio to 3 dp, preserving null. */
const r3 = (n: number | null): number | null => (n === null ? null : Math.round(n * 1000) / 1000);
/** Round a currency amount to cents, preserving null. */
const r2 = (n: number | null): number | null => (n === null ? null : round2(n));

/**
 * Compute the full EVM picture from the four primitives (PURE). See the module header for formulas. Ratios
 * whose denominator is zero come back as `null`, never NaN/Infinity.
 */
export function computeEvm(input: EvmInputs): EvmResult {
  const pv = input.plannedValue;
  const ev = input.earnedValue;
  const ac = input.actualCost;
  const bac = input.budgetAtCompletion;
  const method = input.eacMethod ?? "cpi";

  // Raw ratios (used for downstream forecasts — never the rounded values).
  const cpi = ratio(ev, ac);
  const spi = ratio(ev, pv);

  const cv = ev - ac;
  const sv = ev - pv;

  // EAC variants — each guards its own denominator.
  const eacCpi = cpi !== null && cpi !== 0 ? bac / cpi : null;
  const eacBudgetRate = ac + (bac - ev);
  const eacCpiSpi = cpi !== null && spi !== null && cpi * spi !== 0 ? ac + (bac - ev) / (cpi * spi) : null;
  const eacEtc = input.estimateToComplete !== undefined ? ac + input.estimateToComplete : null;

  const eac =
    method === "budget_rate" ? eacBudgetRate : method === "cpi_spi" ? eacCpiSpi : method === "etc" ? eacEtc : eacCpi;

  const etc = eac !== null ? eac - ac : null;
  const vac = eac !== null ? bac - eac : null;
  const tcpiBac = ratio(bac - ev, bac - ac);
  const tcpiEac = eac !== null ? ratio(bac - ev, eac - ac) : null;

  return {
    plannedValue: pv,
    earnedValue: ev,
    actualCost: ac,
    budgetAtCompletion: bac,
    costVariance: round2(cv),
    scheduleVariance: round2(sv),
    costVariancePct: r3(ratio(cv, ev)),
    scheduleVariancePct: r3(ratio(sv, pv)),
    costPerformanceIndex: r3(cpi),
    schedulePerformanceIndex: r3(spi),
    percentComplete: r3(ratio(ev, bac)),
    percentSpent: r3(ratio(ac, bac)),
    eacMethod: method,
    estimateAtCompletion: r2(eac),
    estimateToComplete: r2(etc),
    varianceAtCompletion: r2(vac),
    toCompletePerformanceIndex: r3(tcpiBac),
    toCompletePerformanceIndexToEac: r3(tcpiEac),
    eacVariants: { cpi: r2(eacCpi), budgetRate: r2(eacBudgetRate), cpiSpi: r2(eacCpiSpi), etc: r2(eacEtc) },
  };
}
