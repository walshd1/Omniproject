import { Router, type Request } from "express";
import { isN8nConfigured, callN8n, authHeaderFromReq, userContextFromReq } from "../lib/n8n";
import { analyticsLimiter } from "../lib/rate-limit";

const router = Router();

export interface PortfolioRow {
  projectId: string;
  projectName: string;
  ragStatus: string;
  scheduleVarianceDays: number;
  budgetVariancePercentage: number;
  activeBlockersCount: number;
}

// Demo-mode sample (used when N8N_WEBHOOK_URL is not configured).
const SAMPLE_PORTFOLIO: PortfolioRow[] = [
  { projectId: "proj-001", projectName: "Platform Rewrite", ragStatus: "AMBER", scheduleVarianceDays: -6, budgetVariancePercentage: 8.4, activeBlockersCount: 3 },
  { projectId: "proj-002", projectName: "API Gateway v2", ragStatus: "GREEN", scheduleVarianceDays: 2, budgetVariancePercentage: -1.2, activeBlockersCount: 0 },
  { projectId: "proj-003", projectName: "Enterprise SSO", ragStatus: "RED", scheduleVarianceDays: -14, budgetVariancePercentage: 22.7, activeBlockersCount: 5 },
  { projectId: "proj-004", projectName: "Monitoring Stack", ragStatus: "GREEN", scheduleVarianceDays: 0, budgetVariancePercentage: 3.1, activeBlockersCount: 1 },
];

/** Shared accessor (route + Prometheus metrics): portfolio-wide health rows. */
export async function getPortfolioHealth(req: Request): Promise<PortfolioRow[]> {
  if (isN8nConfigured) {
    const result = await callN8n<PortfolioRow[]>(
      "get_portfolio_health",
      {},
      { authHeader: authHeaderFromReq(req), source: "portfolio_master", userContext: userContextFromReq(req) },
    );
    return result.data ?? [];
  }
  return SAMPLE_PORTFOLIO;
}

// GET /api/portfolio/health — portfolio-wide multi-project aggregation.
router.get("/portfolio/health", analyticsLimiter, async (req, res) => {
  try {
    res.json(await getPortfolioHealth(req));
  } catch (err) {
    req.log.error({ err }, "get_portfolio_health via n8n failed");
    res.status(502).json({ error: "n8n unreachable" });
  }
});

export default router;
