/**
 * Currency conversion — the pure, dependency-free FX primitives every money roll-up and report shares:
 * convert an amount between currencies via a base-anchored rate table, decide whether a conversion is even
 * possible, list the convertible codes, and the default display currency. Data-agnostic: nothing here knows
 * or cares WHICH figure is being converted (budget, revenue, benefit) — that is the caller's / the spec's
 * concern. Derive-only, no deps, so both the SPA and the gateway import it.
 */

/**
 * Convert between currencies via a base-anchored rate table. Falls back to the original amount if a rate
 * is missing (so a UI never shows NaN) — callers that SUM must gate on {@link isConvertible} first.
 */
export function convertAmount(amount: number, from: string, to: string, rates?: Record<string, number>): number {
  if (!rates || from === to) return amount;
  // Own-property + finite guards: a code like "__proto__" would otherwise read an inherited member.
  const rFrom = Object.hasOwn(rates, from) ? rates[from] : undefined;
  const rTo = Object.hasOwn(rates, to) ? rates[to] : undefined;
  if (!Number.isFinite(rFrom) || !Number.isFinite(rTo) || rTo === 0) return amount;
  return (amount * (rFrom as number)) / (rTo as number);
}

/** Whether `from` can actually be converted to `to` with these rates — callers that SUM across
 *  currencies must use this to exclude unconvertible rows, or a raw foreign amount corrupts the total. */
export function isConvertible(from: string, to: string, rates?: Record<string, number>): boolean {
  if (from === to) return true;
  if (!rates) return false;
  const rFrom = Object.hasOwn(rates, from) ? rates[from] : undefined;
  const rTo = Object.hasOwn(rates, to) ? rates[to] : undefined;
  return Number.isFinite(rFrom) && Number.isFinite(rTo) && rTo !== 0;
}

/** The sorted list of currency codes a rate table can convert between. */
export function currencyList(rates?: Record<string, number>): string[] {
  return rates ? Object.keys(rates).sort() : [];
}

/** The display currency assumed when nothing else resolves one. One place so every surface agrees. */
export const DEFAULT_CURRENCY = "GBP";
