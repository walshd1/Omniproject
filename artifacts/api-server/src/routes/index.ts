import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import contractRouter from "./contract";
import authRouter, { getSession } from "./auth";
import brokerCommandRouter from "./broker-command";
import projectsRouter from "./projects";
import settingsRouter from "./settings";
import programmesRouter from "./programmes";
import portfolioRouter from "./portfolio";
import capabilitiesRouter from "./capabilities";
import brokerLogRouter from "./broker-log";
import setupRouter from "./setup";
import { streamRouter, ingestRouter } from "./notifications-stream";
import aiRouter from "./ai";
import exportRouter from "./export";
import integrationsRouter from "./integrations";
import odataRouter from "./odata";
import historyRouter from "./history";
import licenseRouter from "./license";
import brandingRouter from "./branding";
import labelsRouter from "./labels";
import webhooksRouter from "./webhooks";
import mcpRouter from "./mcp";
import rulesetRouter from "./ruleset";
import importRouter from "./import";
import roleMapRouter from "./role-map";
import rawApiRouter from "./raw-api";
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

// Public: the versioned broker contract (documentation, not data).
router.use(contractRouter);

// Inbound notification ingest from n8n/tools — authed by NOTIFY_INGEST_SECRET,
// not by a user session, and exempt from the per-IP limiter (one n8n source).
router.use(ingestRouter);

// Rate limit everything else under /api/* (auth + data + analytics).
router.use(apiLimiter);

// Audit every action (level-gated) with actor, status and latency.
router.use(auditMiddleware);

// MCP (Model Context Protocol) server — POST /api/mcp, JSON-RPC. Read-only tools
// over the broker seam; self-auths (session OR read-only API token) since MCP is
// POST but the v1 tools are reads. Mounted here so it's rate-limited + audited.
router.use(mcpRouter);

router.use(authRouter);

// Public presentation config: branding + label overrides are needed pre-login
// (the login screen is white-labelled), so they are not auth-gated. Their write
// handlers self-guard with requireRole("admin") + the licence entitlement.
router.use(brandingRouter);
router.use(labelsRouter);

// Protected routes: require an authenticated session (or read-only API token).
router.use(requireAuth, licenseRouter);
router.use(requireAuth, webhooksRouter);
router.use(requireAuth, brokerCommandRouter);
router.use(requireAuth, projectsRouter);
router.use(requireAuth, settingsRouter);
router.use(requireAuth, programmesRouter);
router.use(requireAuth, portfolioRouter);
router.use(requireAuth, capabilitiesRouter);
router.use(requireAuth, setupRouter);
router.use(requireAuth, streamRouter);
router.use(requireAuth, aiRouter);
router.use(requireAuth, exportRouter);
router.use(requireAuth, integrationsRouter);
router.use(requireAuth, odataRouter);
router.use(requireAuth, historyRouter);
router.use(requireAuth, brokerLogRouter);
router.use(requireAuth, rulesetRouter);
router.use(requireAuth, importRouter);
router.use(requireAuth, roleMapRouter);
router.use(requireAuth, rawApiRouter);

export default router;
