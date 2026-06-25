import type { FxRates } from "../broker/types";

/**
 * Indicative, GBP-based FX table used as a sample/fallback only — NOT live market
 * data (note the epoch `asOf` and `provenance: "sample"`). Both the n8n adapter
 * (when a live FX read fails) and the demo adapter serve this same table, so it
 * lives here once — a dependency-free leaf module — to stop the two copies
 * drifting apart without risking an import cycle through the broker.
 */
export const INDICATIVE_FX_RATES: FxRates = {
  base: "GBP",
  rates: { GBP: 1, USD: 0.79, EUR: 0.85, JPY: 0.0053, INR: 0.0095, AUD: 0.52, CAD: 0.58, CHF: 0.89, CNY: 0.11, SGD: 0.59, ZAR: 0.043, BRL: 0.16 },
  provenance: "sample",
  asOf: "1970-01-01T00:00:00.000Z",
};
