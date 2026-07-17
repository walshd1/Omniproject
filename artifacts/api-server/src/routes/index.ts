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
import tasksRouter from "./tasks";
import settingsRouter from "./settings";
import clientErrorsRouter from "./client-errors";
import programmesRouter from "./programmes";
import portfolioRouter from "./portfolio";
import portalRouter from "./portal";
import capabilitiesRouter from "./capabilities";
import brokerLogRouter from "./broker-log";
import setupRouter from "./setup";
import { streamRouter, ingestRouter } from "./notifications-stream";
import aiRouter from "./ai";
import aiProvidersRouter from "./ai-providers";
import exportRouter from "./export";
import archiveRouter from "./archive";
import priorityLabelsRouter from "./priority-labels";
import calendarRouter from "./calendar";
import featuresRouter from "./features";
import rateCardRouter from "./rate-card";
import viewsRouter from "./views";
import dashboardsRouter from "./dashboards";
import customReportsRouter from "./custom-reports";
import contentPagesRouter from "./content-pages";
import screenLayoutsRouter from "./screen-layouts";
import screenDefsRouter from "./screen-defs";
import disabledScreensRouter from "./disabled-screens";
import raciRouter from "./raci";
import stakeholdersRouter from "./stakeholders";
import panelViewsRouter from "./panel-views";
import formsRouter from "./forms";
import automationsRouter from "./automations";
import templatesRouter from "./templates";
import wikiRouter from "./wiki";
import collectionEditRolesRouter from "./collection-edit-roles";
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
import { outputCompositionGate } from "../lib/composition-gate";
import rulesetRouter from "./ruleset";
import importRouter from "./import";
import roleMapRouter from "./role-map";
import customRolesRouter from "./custom-roles";
import systemDefsRouter from "./system-defs";
import rawApiRouter from "./raw-api";
import devModeRouter from "./dev-mode";
import meRouter from "./me";
import toolsRouter from "./tools";
import provenanceRouter from "./provenance";
import securityRouter from "./security";
import healthWatchRouter from "./health-watch";
import usageRouter from "./usage";
import approvalsRouter from "./approvals";
import approvalChainsRouter from "./approval-chains";
import workflowsRouter from "./workflows";
import reportsRouter from "./reports";
import resourceAllocationsRouter from "./resource-allocations";
import budgetPlansRouter from "./budget-plans";
import scimRouter from "./scim";
import breakGlassRouter from "./break-glass";
import { isDeprovisioned, requireRole } from "../lib/rbac";
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

// Hard-gate OUTPUT surfaces (OData, exports, iCal, MCP, metrics, BI feeds, notification stream/ingest) by
// the methodology composition: a curated-out output's endpoint 403s server-side, not just hidden in the SPA.
// One central path→output map so a router mounted at "/" can't leak a gate onto every request.
router.use(outputCompositionGate);

// MCP (Model Context Protocol) server — POST /api/mcp, JSON-RPC. Read-only tools
// over the broker seam; self-auths (session OR read-only API token) since MCP is
// POST but the v1 tools are reads. Mounted here so it's rate-limited + audited.
router.use(mcpRouter);

// SCIM 2.0 provisioning — self-authed by the SCIM bearer token (not a user session), so
// it's mounted outside requireAuth. Rate-limited + audited like the rest of /api.
router.use(scimRouter);

// Strict, per-IP throttle on login / step-up initiation (brute-force / flow-cookie
// spam) — tighter than the general apiLimiter and applied just to these endpoints.
router.use(["/auth/login", "/auth/step-up", "/auth/saml/login", "/auth/oauth2/login", "/auth/magic/request", "/break-glass/lockdown", "/break-glass/release", "/break-glass/status"], loginLimiter);
router.use(authRouter);

// Break-glass containment — the IdP-INDEPENDENT panic button for admin impersonation. Self-authed by
// BREAK_GLASS_TOKEN (a local secret, NOT a user session), so it works when the admin identity can't be
// trusted. Outside requireAuth; the strict per-IP loginLimiter above covers its paths (brute-force guard).
router.use(breakGlassRouter);

// Public presentation config: branding + label overrides are needed pre-login
// (the login screen is white-labelled), so they are not auth-gated. Their write
// handlers self-guard with requireRole("admin") + the licence entitlement.
router.use(brandingRouter);
router.use(labelsRouter);
// Public dev-mode status: the SPA watermarks the screen pre-auth. Always reports
// devMode:false in production (dev mode is hard-gated off there).
router.use(devModeRouter);
router.use(meRouter);

// Client-facing guest portal — invites (manager+) and the guest's own curated project status (guest+).
// Self-gates on GUEST_PORTAL_ENABLED. Mounted BEFORE the viewer-floor gate below so a guest can reach it.
router.use(requireAuth, portalRouter);
// HARD FLOOR: a GUEST principal (below viewer) may reach ONLY the portal above and the public /auth, /me,
// branding endpoints (registered earlier). Everything below is the app proper — stop a guest here so it
// can never fall through to a portfolio/admin router, not even a scope-filtered read. Viewer+ and read-only
// API tokens pass unchanged; unauthenticated callers still hit each protected router's own requireAuth.
router.use(requireRole("viewer"));

// Protected routes: require an authenticated session (or read-only API token).
router.use(requireAuth, licenseRouter);
router.use(requireAuth, webhooksRouter);
router.use(requireAuth, federatedPeersRouter);
router.use(requireAuth, federatedPortfolioRouter);
router.use(requireAuth, brokerCommandRouter);
router.use(requireAuth, projectsRouter);
router.use(requireAuth, tasksRouter);
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
router.use(requireAuth, archiveRouter);
router.use(requireAuth, priorityLabelsRouter);
router.use(requireAuth, calendarRouter);
router.use(requireAuth, featuresRouter);
router.use(requireAuth, rateCardRouter);
// These three carry a toggleable feature module (savedViews / dashboards / contentPages) whose
// UI the SPA hides via useFeatures. Their persistence endpoints must honour the SAME toggle —
// otherwise disabling the feature is decorative (the UI vanishes but /api/views, /api/dashboards
// and /api/content-pages keep accepting reads/writes). requireFeature 404s them once disabled,
// exactly like the lazily-mounted modules (odata / presence / comments).
router.use(requireAuth, requireFeature("savedViews"), viewsRouter);
router.use(requireAuth, requireFeature("dashboards"), dashboardsRouter);
router.use(requireAuth, customReportsRouter);
router.use(requireAuth, requireFeature("contentPages"), contentPagesRouter);
router.use(requireAuth, screenLayoutsRouter);
router.use(requireAuth, screenDefsRouter);
router.use(requireAuth, disabledScreensRouter);
router.use(requireAuth, raciRouter);
router.use(requireAuth, stakeholdersRouter);
router.use(requireAuth, panelViewsRouter);
router.use(requireAuth, formsRouter);
router.use(requireAuth, automationsRouter);
router.use(requireAuth, templatesRouter);
router.use(requireAuth, wikiRouter);
router.use(requireAuth, collectionEditRolesRouter);
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
router.use(requireAuth, customRolesRouter);
router.use(requireAuth, systemDefsRouter);
router.use(requireAuth, rawApiRouter);
router.use(requireAuth, toolsRouter);
router.use(requireAuth, provenanceRouter);
router.use(requireAuth, securityRouter);
router.use(requireAuth, healthWatchRouter);
router.use(requireAuth, usageRouter);
router.use(requireAuth, approvalsRouter);
router.use(requireAuth, approvalChainsRouter);
router.use(requireAuth, workflowsRouter);
router.use(requireAuth, reportsRouter);
router.use(requireAuth, resourceAllocationsRouter);
router.use(requireAuth, budgetPlansRouter);

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
