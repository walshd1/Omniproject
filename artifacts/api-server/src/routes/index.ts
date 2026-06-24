import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter, { getSession } from "./auth";
import n8nProxyRouter from "./n8n-proxy";
import projectsRouter from "./projects";
import programmesRouter from "./programmes";
import portfolioRouter from "./portfolio";
import capabilitiesRouter from "./capabilities";
import setupRouter from "./setup";
import { streamRouter, ingestRouter } from "./notifications-stream";
import aiRouter from "./ai";
import exportRouter from "./export";
import integrationsRouter from "./integrations";
import { hasValidApiToken } from "../lib/api-token";
import { apiLimiter } from "../lib/rate-limit";
import { auditMiddleware } from "./audit-middleware";

const router: IRouter = Router();

/**
 * Gate protected routes behind a valid session OR a read-only API token.
 *
 * - Session principals (OIDC or demo) get full access.
 * - API-token principals are read-only: GET requests only (data + exports),
 *   so a leaked BI token can never mutate. Works in both OIDC and demo mode.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (getSession(req)) {
    next();
    return;
  }
  if (hasValidApiToken(req)) {
    if (req.method !== "GET") {
      res.status(403).json({ error: "API token is read-only" });
      return;
    }
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

// Public routes: health probes (not rate-limited so k8s liveness isn't throttled).
router.use(healthRouter);

// Inbound notification ingest from n8n/tools — authed by NOTIFY_INGEST_SECRET,
// not by a user session, and exempt from the per-IP limiter (one n8n source).
router.use(ingestRouter);

// Rate limit everything else under /api/* (auth + data + analytics).
router.use(apiLimiter);

// Audit every action (level-gated) with actor, status and latency.
router.use(auditMiddleware);

router.use(authRouter);

// Protected routes: require an authenticated session (or read-only API token).
router.use(requireAuth, n8nProxyRouter);
router.use(requireAuth, projectsRouter);
router.use(requireAuth, programmesRouter);
router.use(requireAuth, portfolioRouter);
router.use(requireAuth, capabilitiesRouter);
router.use(requireAuth, setupRouter);
router.use(requireAuth, streamRouter);
router.use(requireAuth, aiRouter);
router.use(requireAuth, exportRouter);
router.use(requireAuth, integrationsRouter);

export default router;
