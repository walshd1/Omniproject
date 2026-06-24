import { Router, type Request } from "express";
import { getBroker, contextFromReq, respondBrokerError, type PortfolioRow } from "../broker";
import { analyticsLimiter } from "../lib/rate-limit";

const router = Router();

export type { PortfolioRow };

/** Shared accessor (route + Prometheus metrics): portfolio-wide health rows. */
export async function getPortfolioHealth(req: Request): Promise<PortfolioRow[]> {
  return getBroker().portfolioHealth(contextFromReq(req));
}

// GET /api/portfolio/health — portfolio-wide multi-project aggregation.
router.get("/portfolio/health", analyticsLimiter, async (req, res) => {
  try {
    res.json(await getPortfolioHealth(req));
  } catch (err) {
    req.log.error({ err }, "get_portfolio_health failed");
    respondBrokerError(res, err);
  }
});

export default router;
