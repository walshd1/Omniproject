/**
 * Monte Carlo schedule/effort-risk simulation — re-export of the vendor-neutral engine.
 *
 * The implementation was promoted below the broker seam into
 * `@workspace/backend-catalogue` so every surface (SPA report, API, analytics) shares one pure
 * simulator instead of re-implementing it. This module keeps the historic SPA import path
 * (`../lib/monte-carlo`) stable for existing consumers (MonteCarloRisk, analytics.bench, fuzz tests).
 */
export {
  simulate,
  mulberry32,
  type RiskTask,
  type SimOptions,
  type SimResult,
} from "@workspace/backend-catalogue";
