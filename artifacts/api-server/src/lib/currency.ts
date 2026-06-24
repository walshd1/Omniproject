import type { Request } from "express";
import { getBroker, contextFromReq, type FxRates } from "../broker";

/**
 * Multi-currency support. OmniProject reads financials in whatever currency each
 * backend reports, and can convert to a single display currency for portfolio
 * comparison using FX rates sourced from the backend/ERP through the broker.
 * Stateless: rates are read-through, not stored. Pure conversion is unit-tested.
 */

export type { FxRates };

/** Convert an amount between currencies via a base-anchored rate table. */
export function convertAmount(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const rFrom = rates[from];
  const rTo = rates[to];
  if (!rFrom || !rTo) throw new Error(`Missing FX rate for ${!rFrom ? from : to}`);
  // amount(from) → base → to
  return (amount * rFrom) / rTo;
}

/** List the currencies the rate table can convert between. */
export function supportedCurrencies(rates: Record<string, number>): string[] {
  return Object.keys(rates).sort();
}

/** Read FX rates through the active broker (demo serves indicative rates). */
export async function getFxRates(req: Request): Promise<FxRates> {
  return getBroker().fxRates(contextFromReq(req));
}
