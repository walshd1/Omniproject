import type { Request } from "express";
import { isN8nConfigured, callN8n, authHeaderFromReq } from "./n8n";

/**
 * Multi-currency support. OmniProject reads financials in whatever currency each
 * backend reports, and can convert to a single display currency for portfolio
 * comparison using FX rates sourced from the backend/ERP via n8n
 * (action get_fx_rates, source fx_provider). Stateless: rates are read-through,
 * not stored. Pure conversion is unit-tested.
 */

export interface FxRates {
  base: string;
  /** Units of `base` per 1 unit of the keyed currency (so amount_base = amount * rates[ccy]). */
  rates: Record<string, number>;
  provenance: "sourced" | "sample";
  asOf: string;
}

// Indicative demo rates (base GBP). Real deployments source these from n8n.
const DEMO_RATES: FxRates = {
  base: "GBP",
  rates: { GBP: 1, USD: 0.79, EUR: 0.85, JPY: 0.0053, INR: 0.0095, AUD: 0.52, CAD: 0.58, CHF: 0.89, CNY: 0.11, SGD: 0.59, ZAR: 0.043, BRL: 0.16 },
  provenance: "sample",
  asOf: "1970-01-01T00:00:00.000Z",
};

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

export async function getFxRates(req: Request): Promise<FxRates> {
  if (isN8nConfigured) {
    try {
      const r = await callN8n<Partial<FxRates>>("get_fx_rates", {}, { authHeader: authHeaderFromReq(req), source: "fx_provider" });
      const data = r.data;
      if (data && data.rates && typeof data.rates === "object") {
        return {
          base: data.base || "GBP",
          rates: data.rates,
          provenance: "sourced",
          asOf: data.asOf || new Date().toISOString(),
        };
      }
    } catch {
      // fall through to demo rates
    }
  }
  return DEMO_RATES;
}
