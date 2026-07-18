/**
 * Setup-wizard + operations plane. This module is the COMPOSITION ROOT: it holds the deployment
 * status / profile / identity / self-host / charity-onboarding endpoints (the "who + how am I
 * deployed" surface) and mounts the four cohesive sub-planes it used to inline (Stage 3 split):
 *
 *   ./setup/catalogues.ts   — read-only "what CAN be wired" catalogues + screen layouts
 *   ./setup/connections.ts  — broker/webhook probes, credential templates/vault, workflow gen/verify
 *   ./setup/config-io.ts    — export / config-dir / bundle / snapshot / restore / debug-bundle
 *   ./setup/environments.ts — sandbox → promote → rollback over versioned config
 *
 * All sub-routers register full `/setup/...` paths and are mounted here with `router.use`, so the
 * assembled route surface (and every path, guard, and test) is byte-for-byte unchanged. Mostly
 * admin-gated; this is the operator-facing surface for wiring + lifecycle, not project data.
 */
import { Router } from "express";
import { updateSettings } from "../lib/settings";
import { resolveSelfHost, sanitizeSelfHost, SELF_HOST_CONFIG_ID } from "../lib/self-host-config";
import { writeOrgConfigCollection } from "../lib/scoped-config";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { requireRole, requireAnyRole, getRoleMap } from "../lib/rbac";
import { isTruthy } from "../lib/env-config";
import { selfHostGatingForScope } from "../selfhost";
import { deploymentProfile, profilePosture, requireTls, acceptDemoAuth, demoAuthSeverity, profileCatalogue, DEPLOYMENT_PROFILES } from "../lib/deployment-profile";
import { bootRefusalActive } from "../lib/security-check";
import { brokerMtlsConfigured } from "../lib/broker-transport";
import { applyCharityOnboarding } from "../lib/charity-onboarding";
import { sharedStateMode } from "../lib/shared-state";
import { IDP_PRESETS } from "../lib/idp-presets";
import { isOidcConfigured } from "../lib/oidc";
import { isSamlConfigured } from "../lib/saml";
import { baseUrl } from "./auth";
import catalogueRoutes from "./setup/catalogues";
import connectionRoutes from "./setup/connections";
import configIoRoutes from "./setup/config-io";
import environmentRoutes from "./setup/environments";
import { buildSetupStatus, buildPublicSetupStatus } from "../lib/setup-status";

const router = Router();

/**
 * Setup / Connection Center endpoints. These are gateway control-plane (like
 * /auth), so the SPA calls them directly rather than through the generated data
 * client. Nothing here is persisted — the wizard reflects current settings and
 * emits durable config for the operator to keep in their environment.
 */

// GET /api/setup/status — what's wired, for the Configurator. Read-only, but carries
// live broker/backend/licensing state, so it's an INTERNAL call restricted to the
// entities that actually own that state (PMO/admin). Assembled from a registry of
// status sections (see lib/setup-status.ts).
router.get("/setup/status", requireAnyRole("pmo", "admin"), async (req, res) => {
  res.json(await buildSetupStatus(req));
});

// GET /api/setup/status/public — the OUTER surface: the one fact every authenticated
// session needs regardless of role (e.g. the demo-mode banner in the global chrome).
// Non-PMO/admin callers reach only this passed-through subset, never the internal route above.
router.get("/setup/status/public", (_req, res) => {
  res.json(buildPublicSetupStatus());
});

// GET /api/setup/profile — the deployment profile + posture, and which enterprise hardening
// is on vs off (everything is opt-in). Lets the setup UI show "you've relaxed X by choice"
// vs "recommended for your profile". Admin-only; reports config, never secrets.
router.get("/setup/profile", requireRole("admin"), (_req, res) => {
  const posture = profilePosture();
  res.json({
    profile: deploymentProfile(),
    posture,
    tls: { servedOverTls: requireTls() },
    demoAuth: { active: !process.env["OIDC_ISSUER_URL"]?.trim(), accepted: acceptDemoAuth(), severity: demoAuthSeverity() },
    // The advanced controls and whether each is currently engaged (all default OFF).
    hardening: {
      oidc: !!process.env["OIDC_ISSUER_URL"]?.trim(),
      scim: !!process.env["SCIM_TOKEN"]?.trim(),
      ipAllowlist: !!process.env["IP_ALLOWLIST"]?.trim(),
      sessionCap: Number(process.env["MAX_SESSIONS_PER_USER"]) > 0,
      kms: (process.env["KMS_PROVIDER"]?.trim() || "none") !== "none",
      makerChecker: !!process.env["DUAL_CONTROL_ACTIONS"]?.trim(),
      securityStrict: bootRefusalActive(process.env),
      rateLimit: !isTruthy(process.env["RATE_LIMIT_DISABLED"]),
      // Tamper-resistant MFA (hardware-bound amr/acr) gates pmo/admin authority whenever
      // real SSO is configured — it's unconditional enforcement, not a separate toggle.
      // Demo mode has no real identity to gate, so this reads false there (already
      // covered by the demoAuth warning above).
      strongMfaAdminPmo: isOidcConfigured || isSamlConfigured(),
      // Whether per-replica registries (e.g. the maker-checker queue) are shared fleet-wide.
      sharedState: sharedStateMode(),
      // Mutual TLS to the broker (client cert + optional private CA) — defence in depth
      // on top of the HMAC/PSK signing every broker call already carries.
      mtls: brokerMtlsConfigured(),
    },
    profiles: DEPLOYMENT_PROFILES,
    // The picker catalogue: every customer type's posture + preset (audience, what it relaxes,
    // suggested env, recommendations).
    catalogue: profileCatalogue(),
  });
});

// GET /api/setup/idp — guided identity setup, especially the BUNDLED IdP (Authentik) path for
// charities/self-hosters with no corporate IdP. OmniProject delegates identity, so this tells
// the admin exactly how to give staff real accounts + roles. Admin-only; no secrets.
router.get("/setup/idp", requireRole("admin"), (req, res) => {
  const issuer = process.env["OIDC_ISSUER_URL"]?.trim() || "";
  const mode = issuer ? "oidc" : "demo";
  let issuerOrigin = "";
  try { if (issuer) issuerOrigin = new URL(issuer).origin; } catch { /* malformed issuer */ }
  // "Bundled" = the Authentik that ships in docker-compose.standalone.yml.
  const bundled = /authentik/i.test(issuer);
  const base = baseUrl(req);
  // The redirect URI the IdP must allow (the one thing operators get wrong).
  const callbackUrl = `${base}/api/auth/callback`;
  // The live group→role mapping (so they know which IdP group grants which role)…
  const roleGroups = getRoleMap().map((m) => ({ role: m.role, groups: m.claims }));
  // …and the default group names the bundled blueprint creates (for demo-mode guidance).
  const suggestedGroups: Record<string, string> = {
    admin: "omni-admins", pmo: "omni-pmo", manager: "omni-managers", contributor: "omni-contributors", viewer: "omni-viewers",
  };
  res.json({ mode, issuer, issuerOrigin, bundled, callbackUrl, roleGroups, suggestedGroups, presets: IDP_PRESETS, profile: deploymentProfile() });
});

// POST /api/setup/profile — pick the deployment profile from the wizard (admin). Persists it
// (overrides the env default) so the TLS posture + the no-IdP severity follow the chosen type.
// Infra-level env (DEPLOYMENT_PROFILE) remains the source of truth across a fresh boot.
router.post("/setup/profile", requireRole("admin"), (req, res) => {
  const profile = typeof req.body?.profile === "string" ? req.body.profile.trim().toLowerCase() : "";
  if (!(DEPLOYMENT_PROFILES as readonly string[]).includes(profile)) {
    res.status(400).json({ error: `profile must be one of: ${DEPLOYMENT_PROFILES.join(", ")}` });
    return;
  }
  updateSettings({ deploymentProfile: profile });
  res.json({ profile: deploymentProfile(), posture: profilePosture(), tls: { servedOverTls: requireTls() } });
});

// GET /api/setup/self-host — the current self-host DB adoption + its resolved domain gating for a
// scope (admin/PMO). Programme/project narrowing reuses the existing governance maps, so the admin
// screen sees the same resolution the composition tier runs. Read-only; never project data.
router.get("/setup/self-host", requireAnyRole("admin", "pmo"), (req, res) => {
  const config = resolveSelfHost();
  const programmeId = (req.query["programmeId"] as string | undefined)?.trim() || null;
  const projectId = (req.query["projectId"] as string | undefined)?.trim() || null;
  const gating = selfHostGatingForScope({ programmeId, projectId });
  res.json({
    config,
    mode: gating.mode,
    holdsOnlyCopy: config.mode !== "off",
    domains: gating.rows,
    enabledDomains: [...gating.enabledDomainIds],
  });
});

// POST /api/setup/self-host — adopt (or turn off) the self-host DB from the wizard/admin (admin).
// The "disclose, don't insure" gate lives in `sanitizeSelfHost`: a non-off mode without the data-responsibility
// acknowledgement is rejected (400), so this can never persist an un-acknowledged adoption. It's a CHOICE config
// def (`self-host`) — the ack is the gate, so this applies immediately (never a sign-off), unchanged from before.
router.post("/setup/self-host", requireRole("admin"), (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const mode = typeof body["mode"] === "string" ? body["mode"] : "off";
  const adopted = Array.isArray(body["adopted"]) ? body["adopted"].filter((x): x is string => typeof x === "string") : [];
  const ack = body["acknowledgedDataResponsibility"] === true;
  try {
    writeOrgConfigCollection(SELF_HOST_CONFIG_ID, "Self-host", sanitizeSelfHost({ mode, adopted, acknowledgedDataResponsibility: ack }));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "invalid self-host config" });
    return;
  }
  const config = resolveSelfHost();
  const gating = selfHostGatingForScope();
  res.json({ config, domains: gating.rows, enabledDomains: [...gating.enabledDomainIds], holdsOnlyCopy: config.mode !== "off" });
});

// POST /api/setup/charity-onboarding — the "We're a charity" one-click preset (admin). Selects
// the nonprofit deployment profile, mints the trustee-report + funder-report dashboard presets
// (existing widgets only), and best-effort adopts the active backend's nomenclature preset if
// one exists and the deployment is entitled to it. Idempotent — see lib/charity-onboarding.ts.
router.post("/setup/charity-onboarding", requireRole("admin"), (_req, res) => {
  res.json(applyCharityOnboarding());
});

// The cohesive sub-planes (each registers its own `/setup/...` paths). Order is irrelevant — the
// paths are disjoint — but grouped read → wiring → config-io → lifecycle for readability.
router.use(catalogueRoutes);
router.use(connectionRoutes);
router.use(configIoRoutes);
router.use(environmentRoutes);

export default router;
