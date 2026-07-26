/**
 * MULTI-CURRENCY EAC / ETC — the plan-layer cost forecast when a programme's cost lines land in more than one
 * currency (roadmap §4.1, "multi-currency EAC/ETC"). A global portfolio books actuals in local currencies; to
 * forecast the estimate-at-completion the whole thing has to be expressed in ONE base currency first. This engine
 * is the honest composition of the two primitives that already exist: it converts each currency-tagged cost line
 * to the base via {@link convertAmount} (gating every line on {@link isConvertible} so a foreign amount can never
 * be summed raw into the total), sums per EVM measure, and then runs the existing {@link computeEvm} on the
 * base-currency totals — so the multi-currency path and the single-currency path can never disagree on the maths.
 *
 * Lines whose currency cannot be converted with the supplied rate table are SURFACED in `unconvertible` and
 * excluded from the totals, never silently folded in (the classic way a mixed-currency roll-up goes wrong). Pure,
 * no I/O; deterministic (measures processed in a fixed order, unconvertible lines in input order — no Math.random);
 * validation first (every amount coerced via numLoose; a missing/zero rate falls back safely inside convertAmount).
 */
import { numLoose } from "./num";
import { convertAmount, isConvertible, DEFAULT_CURRENCY } from "./currency";
import { computeEvm, type EacMethod, type EvmResult } from "./evm";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** One cost figure booked in a specific currency. */
export interface CurrencyAmount {
  amount: number;
  currency: string;
}

export interface MultiCurrencyEvmInputs {
  /** Planned value (PV) lines. */
  plannedValue: CurrencyAmount[];
  /** Earned value (EV) lines. */
  earnedValue: CurrencyAmount[];
  /** Actual cost (AC) lines. */
  actualCost: CurrencyAmount[];
  /** Budget at completion (BAC) lines. */
  budgetAtCompletion: CurrencyAmount[];
  /** Optional bottom-up estimate-to-complete lines (only used by the "etc" EAC method). */
  estimateToComplete?: CurrencyAmount[];
  /** Currency every measure is converted into. Defaults to DEFAULT_CURRENCY. */
  baseCurrency?: string;
  /** Base-anchored FX rate table (as convertAmount/isConvertible expect). */
  rates?: Record<string, number>;
  /** Which EAC formula the headline forecast uses (passed through to computeEvm). */
  eacMethod?: EacMethod;
}

/** A cost line that could not be converted to the base currency (surfaced, excluded from the totals). */
export interface UnconvertibleLine {
  measure: "plannedValue" | "earnedValue" | "actualCost" | "budgetAtCompletion" | "estimateToComplete";
  amount: number;
  currency: string;
}

export interface MultiCurrencyEvmResult {
  baseCurrency: string;
  /** The base-currency totals fed into the EVM engine (unconvertible lines excluded). */
  converted: {
    plannedValue: number;
    earnedValue: number;
    actualCost: number;
    budgetAtCompletion: number;
    estimateToComplete: number | null;
  };
  /** The full EVM result computed on the base-currency totals. */
  evm: EvmResult;
  /** Lines excluded because their currency is not convertible with the supplied rates (input order). */
  unconvertible: UnconvertibleLine[];
  /** Distinct source currencies across every line, most-common first — "consolidated from N currencies". */
  currencyMix: Array<{ currency: string; count: number }>;
}

/**
 * Sum a measure's lines in the base currency. Convertible lines (including same-currency) are converted and added;
 * unconvertible lines are pushed to `sink` and excluded. Every source currency is recorded in `seen` for the mix.
 */
function sumInBase(
  lines: readonly CurrencyAmount[] | undefined,
  measure: UnconvertibleLine["measure"],
  base: string,
  rates: Record<string, number> | undefined,
  sink: UnconvertibleLine[],
  seen: string[],
): number {
  let total = 0;
  for (const line of lines ?? []) {
    const currency = String(line.currency);
    const amount = numLoose(line.amount);
    seen.push(currency);
    if (isConvertible(currency, base, rates)) {
      total += convertAmount(amount, currency, base, rates);
    } else {
      sink.push({ measure, amount: round2(amount), currency });
    }
  }
  return total;
}

/** Tally distinct currency codes, most-common first, with a deterministic code tiebreak. */
function mixOf(currencies: readonly string[]): Array<{ currency: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of currencies) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()]
    .map(([currency, count]) => ({ currency, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/**
 * Convert mixed-currency EVM measures to a single base currency and compute EAC/ETC/VAC on the totals. Empty
 * inputs ⇒ zero totals (computeEvm returns guarded nulls for the derived ratios). Unconvertible lines are
 * surfaced, not summed.
 */
export function computeMultiCurrencyEvm(input: MultiCurrencyEvmInputs): MultiCurrencyEvmResult {
  const base = input.baseCurrency ? String(input.baseCurrency) : DEFAULT_CURRENCY;
  const rates = input.rates;
  const unconvertible: UnconvertibleLine[] = [];
  const seen: string[] = [];

  const plannedValue = sumInBase(input.plannedValue, "plannedValue", base, rates, unconvertible, seen);
  const earnedValue = sumInBase(input.earnedValue, "earnedValue", base, rates, unconvertible, seen);
  const actualCost = sumInBase(input.actualCost, "actualCost", base, rates, unconvertible, seen);
  const budgetAtCompletion = sumInBase(input.budgetAtCompletion, "budgetAtCompletion", base, rates, unconvertible, seen);
  const hasEtc = Array.isArray(input.estimateToComplete);
  const estimateToComplete = hasEtc
    ? sumInBase(input.estimateToComplete, "estimateToComplete", base, rates, unconvertible, seen)
    : null;

  const evm = computeEvm({
    plannedValue,
    earnedValue,
    actualCost,
    budgetAtCompletion,
    ...(estimateToComplete !== null ? { estimateToComplete } : {}),
    ...(input.eacMethod ? { eacMethod: input.eacMethod } : {}),
  });

  return {
    baseCurrency: base,
    converted: {
      plannedValue: round2(plannedValue),
      earnedValue: round2(earnedValue),
      actualCost: round2(actualCost),
      budgetAtCompletion: round2(budgetAtCompletion),
      estimateToComplete: estimateToComplete === null ? null : round2(estimateToComplete),
    },
    evm,
    unconvertible,
    currencyMix: mixOf(seen),
  };
}
