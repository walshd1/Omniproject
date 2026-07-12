/**
 * The /api router assembly — mounts every route module in order and applies the
 * cross-cutting gates: public routes first (health, contract, OpenAPI spec,
 * ingest), then the rate limiter + audit, then the authenticated surface behind
 * requireAuth. The single place that defines what is public vs authed.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import contractRouter from "./contract";
import apiSpecRouter from "./api-spec";
import authRouter, { getSession } from "./auth";
import brokerCommandRouter from "./broker-command";
import projectsRouter from "./projects";
import settingsRouter from "./settings";
import clientErrorsRouter from "./client-errors";
import programmesRouter from "./programmes";
import portfolioRouter from "./portfolio";
import capabilitiesRouter from "./capabilities";
import brokerLogRouter from "./broker-log";
import setupRouter from "./setup";
import { streamRouter, ingestRouter } from "./notifications-stream";
import aiRouter from "./ai";
import aiProvidersRouter from "./ai-providers";
import exportRouter from "./export";
import featuresRouter from "./features";
import rateCardRouter from "./rate-card";
import viewsRouter from "./views";
import dashboardsRouter from "./dashboards";
import customReportsRouter from "./custom-reports";
import contentPagesRouter from "./content-pages";
import reportOverridesRouter from "./report-overrides";
import routingRouter from "./routing";
import customFieldsRouter from "./custom-fields";
import fieldValidationRouter from "./field-validation";
import programmeRegistryRouter from "./programme-registry";
import brokerKindsRouter from "./broker-kinds";
import closedProjectsRouter from "./closed-projects";
import guidAliasesRouter from "./guid-aliases";
import portfolioPriorityWeightsRouter from "./portfolio-priority-weights";
import snapshotsRouter from "./snapshots";
import historyRouter from "./history";
import timesheetsRouter from "./timesheets";
import licenseRouter from "./license";
import brandingRouter from "./branding";
import labelsRouter from "./labels";
import webhooksRouter from "./webhooks";
import federatedPeersRouter from "./federated-peers";
import federatedPortfolioRouter from "./federated-portfolio";
import mcpRouter from "./mcp";
import rulesetRouter from "./ruleset";
import importRouter from "./import";
import roleMapRouter from "./role-map";
import rawApiRouter from "./raw-api";
import devModeRouter from "./dev-mode";
import meRouter from "./me";
import toolsRouter from "./tools";
import provenanceRouter from "./provenance";
import securityRouter from "./security";
import healthWatchRouter from "./health-watch";
import scimRouter from "./scim";
import { isDeprovisioned } from "../lib/rbac";
import { hasValidApiToken } from "../lib/api-token";
import { apiLimiter, loginLimiter } from "../lib/rate-limit";
import { auditMiddleware } from "./audit-middleware";
import { FEATURE_MODULES, isFeatureEnabled, markFeatureLoaded, requireFeature } from "../lib/feature-modules";
import { logger } from "../lib/logger";

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
    // SCIM lifecycle: a deprovisioned (active=false) user is denied even with a valid OIDC
    // session, so the IdP disabling an account takes effect here immediately.
    if (isDeprovisioned(req)) { res.status(403).json({ error: "Account has been deactivated." }); return; }
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

// Public: the broker-agnostic consumer API spec + discovery (documentation).
router.use(apiSpecRouter);

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

// SCIM 2.0 provisioning — self-authed by the SCIM bearer token (not a user session), so
// it's mounted outside requireAuth. Rate-limited + audited like the rest of /api.
router.use(scimRouter);

// Strict, per-IP throttle on login / step-up initiation (brute-force / flow-cookie
// spam) — tighter than the general apiLimiter and applied just to these endpoints.
router.use(["/auth/login", "/auth/step-up", "/auth/saml/login", "/auth/oauth2/login", "/auth/magic/request"], loginLimiter);
router.use(authRouter);

// Public presentation config: branding + label overrides are needed pre-login
// (the login screen is white-labelled), so they are not auth-gated. Their write
// handlers self-guard with requireRole("admin") + the licence entitlement.
router.use(brandingRouter);
router.use(labelsRouter);
// Public dev-mode status: the SPA watermarks the screen pre-auth. Always reports
// devMode:false in production (dev mode is hard-gated off there).
router.use(devModeRouter);
router.use(meRouter);

// Protected routes: require an authenticated session (or read-only API token).
router.use(requireAuth, licenseRouter);
router.use(requireAuth, webhooksRouter);
router.use(requireAuth, federatedPeersRouter);
router.use(requireAuth, federatedPortfolioRouter);
router.use(requireAuth, brokerCommandRouter);
router.use(requireAuth, projectsRouter);
router.use(requireAuth, settingsRouter);
router.use(requireAuth, clientErrorsRouter);
router.use(requireAuth, programmesRouter);
router.use(requireAuth, portfolioRouter);
router.use(requireAuth, capabilitiesRouter);
router.use(requireAuth, setupRouter);
router.use(requireAuth, streamRouter);
router.use(requireAuth, aiRouter);
router.use(requireAuth, aiProvidersRouter);
router.use(requireAuth, exportRouter);
router.use(requireAuth, featuresRouter);
router.use(requireAuth, rateCardRouter);
router.use(requireAuth, viewsRouter);
router.use(requireAuth, dashboardsRouter);
router.use(requireAuth, customReportsRouter);
router.use(requireAuth, contentPagesRouter);
router.use(requireAuth, reportOverridesRouter);
router.use(requireAuth, routingRouter);
router.use(requireAuth, customFieldsRouter);
router.use(requireAuth, fieldValidationRouter);
router.use(requireAuth, programmeRegistryRouter);
router.use(requireAuth, brokerKindsRouter);
router.use(requireAuth, closedProjectsRouter);
router.use(requireAuth, guidAliasesRouter);
router.use(requireAuth, portfolioPriorityWeightsRouter);
router.use(requireAuth, snapshotsRouter);
router.use(requireAuth, historyRouter);
router.use(requireAuth, timesheetsRouter);
router.use(requireAuth, brokerLogRouter);
router.use(requireAuth, rulesetRouter);
router.use(requireAuth, importRouter);
router.use(requireAuth, roleMapRouter);
router.use(requireAuth, rawApiRouter);
router.use(requireAuth, toolsRouter);
router.use(requireAuth, provenanceRouter);
router.use(requireAuth, securityRouter);
router.use(requireAuth, healthWatchRouter);

/**
 * Mount the optional feature modules. Each enabled module is reached through a dynamic
 * `import()`, so a DISABLED module's route code is never loaded at startup (esbuild puts it in
 * its own chunk). A `requireFeature` gate also 404s an enabled-then-disabled module at runtime.
 * Run via top-level await so the modules are mounted by the time the app graph finishes loading
 * (the server boots after this, and the route tests import the fully-assembled app).
 */
async function mountFeatureModules(): Promise<void> {
  for (const m of FEATURE_MODULES) {
    if (!m.load) continue; // UI-only module — no backend route to mount (SPA gates it)
    if (!isFeatureEnabled(m.id)) {
      logger.info({ feature: m.id }, "feature module disabled — backend code not loaded");
      continue;
    }
    try {
      const mod = await m.load();
      router.use(requireAuth, requireFeature(m.id), mod.default);
      markFeatureLoaded(m.id);
    } catch (err) {
      logger.error({ err, feature: m.id }, "failed to load feature module");
    }
  }
}

await mountFeatureModules();

export default router;
