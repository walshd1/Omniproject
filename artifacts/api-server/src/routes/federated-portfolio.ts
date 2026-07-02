import { Router } from "express";
import { analyticsLimiter } from "../lib/rate-limit";
import { buildFederatedPortfolio } from "../lib/federation";

/**
 * GET /api/federated-portfolio — this instance's own portfolio summary PLUS every configured peer's
 * (backlog #135), fanned out live and merged into one response, each contribution clearly labeled by
 * peer/region and never silently blended into a single number. See lib/federation.ts for the fan-out
 * and docs/DATA-RESIDENCY.md for what does/doesn't cross an instance boundary.
 */
const router = Router();

router.get("/federated-portfolio", analyticsLimiter, async (req, res) => {
  try {
    res.json(await buildFederatedPortfolio(req));
  } catch (err) {
    req.log.error({ err }, "get_federated_portfolio failed");
    res.status(502).json({ error: "Could not build the federated portfolio view" });
  }
});

export default router;
