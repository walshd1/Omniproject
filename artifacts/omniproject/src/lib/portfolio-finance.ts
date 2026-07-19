/**
 * Portfolio financial consolidation — now the ONE shared, dependency-free implementation in
 * `@workspace/backend-catalogue` (`financials`), used by BOTH this SPA (the Portfolio
 * Financials report + Exec Board Pack) and the gateway's `/api/portfolio/financials` fan-out, so the
 * client and server can never drift. Re-exported here so existing SPA importers keep this path.
 */
export {
  consolidateFinancials,
  type ProjectFin,
  type FinanceRollup,
  type CurrencyMix,
  type LocalTotals,
} from "@workspace/backend-catalogue";
