/**
 * Portfolio analytics endpoints — portfolio-wide RAG/health and resource-capacity
 * roll-ups read through the broker (rate-limited as analytics). Read-only; the
 * aggregation maths lives in lib/ (resource-pool etc.), the data in the broker.
 */
import { Router, type Request } from "express";
import { getBroker, contextFromReq, withBrokerErrors, type PortfolioRow } from "../broker";
import { analyticsLimiter } from "../lib/rate-limit";
import { computeLocalPortfolioSummary, type PortfolioSummary } from "../lib/portfolio-summary";

const router = Router();

export type { PortfolioRow };

/** Shared accessor (route + Prometheus metrics): portfolio-wide health rows. */
export async function getPortfolioHealth(req: Request): Promise<PortfolioRow[]> {
  return getBroker().portfolioHealth(contextFromReq(req));
}

// GET /api/portfolio/health — portfolio-wide multi-project aggregation.
router.get("/portfolio/health", analyticsLimiter, (req, res) =>
  withBrokerErrors(req, res, "get_portfolio_health failed", async () => {
    res.json(await getPortfolioHealth(req));
  }),
);

// GET /api/portfolio/summary — THIS instance's own pre-aggregated portfolio totals (health/finance/
// capacity), never per-project detail. The one endpoint a federated peer is meant to call (see
// lib/federation.ts); served under the same requireAuth gate as the rest of /api (routes/index.ts),
// which already accepts a read-only API token — so a peer instance can reach it with nothing more
// than a bearer token, no new cross-instance auth scheme.
router.get("/portfolio/summary", analyticsLimiter, (req, res) =>
  withBrokerErrors(req, res, "get_portfolio_summary failed", async () => {
    const summary: PortfolioSummary = await computeLocalPortfolioSummary(req);
    res.json(summary);
  }),
);

export default router;
