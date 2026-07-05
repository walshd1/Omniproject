/**
 * Setup-wizard + operations endpoints — backend/plane catalogues, workflow
 * generation + verification, config export/snapshot/restore, the sandbox→promote→
 * rollback environment controls, and the debug bundle. Mostly admin-gated; this is
 * the operator-facing surface for wiring + lifecycle, not project data.
 */
import { Router, type Response } from "express";
import { getSettings, updateSettings } from "../lib/settings";
import { resolveCapabilities, resolveSupport } from "../lib/capabilities";
import { connectedBrokerKinds } from "../broker/registry";
import { contextFromReq, brokerVerifyConnection, brokerStoreCredential, callBrokerCapability, probeVerifiableActions } from "../broker";
import { v, parseOr400 } from "../lib/validate";
import { assertEgressAllowed, EgressError } from "../lib/egress";

// Typed + bounded bodies for the broker-credential routes (untrusted admin input).
const CONNECTION_TEST_BODY = v.object({ backend: v.string({ trim: true, min: 1, max: 100 }) });
const CONNECTION_VAULT_BODY = v.object({
  backend: v.string({ trim: true, min: 1, max: 100 }),
  name: v.string({ trim: true, min: 1, max: 200 }),
  value: v.string({ min: 1, max: 8_000 }), // a secret — not trimmed
});
import { requireRole, requireAnyRole, hasRole, getRoleMap } from "../lib/rbac";
import { buildConfigExport, type ExportFormat } from "../lib/config-export";
import { backendCatalogue, getBackend, isEnterpriseBackend, generateWorkflow, brokerCatalogue, outputCatalogue, notificationCatalogue, notificationRouteCatalogue, notificationKindCatalogue, methodologyCatalogue, methodologyPack, allMethodologyTags, reportCatalogue, screenCatalogue, reportsForMethodology, screensForMethodology, planeCatalogue, availableReports, availableScreens, VIEWS, viewsForMethodology, dedupeEntities, matchCandidates, normaliseKey } from "@workspace/backend-catalogue";
import { isEntitled, resolveLicense } from "../lib/license";
import { auditStatus } from "../lib/audit";
import { isDevMode } from "../lib/dev-mode";
import { buildDebugBundleZip } from "../lib/debug-bundle";
import { requiredCredentials, renderCredentialTemplate } from "../lib/connection-credentials";
import { buildSnapshot, applySnapshot } from "../lib/config-snapshot";
import { configDirSummary } from "../lib/config-dir";
import { refreshConfigDir, configBackupInfo, clearConfigBackup } from "../lib/config-refresh";
import { requireStepUp } from "../lib/step-up";
import { recordAudit } from "../lib/audit";
import { getSession, baseUrl } from "./auth";
import { buildConfigBundle } from "../lib/config-bundle";
import { buildSetupStatus, buildPublicSetupStatus } from "../lib/setup-status";
import { deploymentProfile, profilePosture, requireTls, acceptDemoAuth, demoAuthSeverity, profileCatalogue, DEPLOYMENT_PROFILES } from "../lib/deployment-profile";
import { bootRefusalActive } from "../lib/security-check";
import { brokerMtlsConfigured } from "../lib/broker-transport";
import { applyCharityOnboarding } from "../lib/charity-onboarding";
import { sharedStateMode } from "../lib/shared-state";
import { IDP_PRESETS } from "../lib/idp-presets";
import { isOidcConfigured } from "../lib/oidc";
import { isSamlConfigured } from "../lib/saml";
import {
  storeView,
  captureVersion,
  createEnvironment,
  activateEnvironment,
  markKnownGood,
  rollbackTo,
  rollbackToLastKnownGood,
  promote,
} from "../lib/config-store";
import { isFeatureEnabled } from "../lib/feature-modules";

const router = Router();

const isOn = (v: string | undefined): boolean => v?.trim().toLowerCase() === "true" || v?.trim().toLowerCase() === "on";

/** Governance gate for the report/methodology planes: a PMO `forbid report:x` / `forbid methodology:x`
 *  (or a `require` elsewhere) actually withholds the item from what's offered, not just the admin table.
 *  Resolved at org scope — the surface here is the global catalogue, so org-level mandates apply. */
const reportAllowed = (id: string): boolean => isFeatureEnabled(`report:${id}`);
const methodologyAllowed = (id: string): boolean => isFeatureEnabled(`methodology:${id}`);

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
      rateLimit: !isOn(process.env["RATE_LIMIT_DISABLED"]),
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

// POST /api/setup/charity-onboarding — the "We're a charity" one-click preset (admin). Selects
// the nonprofit deployment profile, mints the trustee-report + funder-report dashboard presets
// (existing widgets only), and best-effort adopts the active backend's nomenclature preset if
// one exists and the deployment is entitled to it. Idempotent — see lib/charity-onboarding.ts.
router.post("/setup/charity-onboarding", requireRole("admin"), (_req, res) => {
  res.json(applyCharityOnboarding());
});

// POST /api/setup/test-broker — non-destructive reachability + capability probe of
// a candidate broker webhook URL (does NOT change settings). Admin only.
router.post("/setup/test-broker", requireRole("admin"), async (req, res) => {
  const url = typeof req.body?.webhookUrl === "string" ? req.body.webhookUrl.trim() : "";
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ reachable: false, error: "Provide an absolute http(s) webhook URL" });
    return;
  }

  try {
    await assertEgressAllowed(url); // SSRF guard: never let an admin-pasted URL reach metadata/link-local
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OmniProject-Action": "get_capabilities",
        "X-OmniProject-Source": "capability_probe",
        "X-OmniProject-Origin": "omniproject",
      },
      body: JSON.stringify({ action: "get_capabilities", payload: {}, source: "capability_probe", origin: "omniproject" }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!r.ok) {
      res.json({ reachable: true, ok: false, status: r.status, error: `Webhook responded ${r.status}` });
      return;
    }

    const json = (await r.json().catch(() => ({}))) as { data?: Record<string, boolean>; success?: boolean };
    const capabilities = json && typeof json === "object" && json.data && typeof json.data === "object" ? json.data : null;
    res.json({
      reachable: true,
      ok: true,
      status: r.status,
      implementsCapabilities: !!capabilities,
      capabilities,
    });
  } catch (err) {
    if (err instanceof EgressError) {
      res.json({ reachable: false, error: err.message });
      return;
    }
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    res.json({ reachable: false, error: isTimeout ? "Connection timed out" : "Could not reach the webhook URL" });
  }
});

// GET /api/setup/export?format=env|compose|k8s — durable config from current
// settings, so the operator can persist it in their environment. Admin only.
router.get("/setup/export", requireRole("admin"), (req, res) => {
  const fmt = String(req.query["format"] ?? "env");
  const format: ExportFormat = fmt === "compose" || fmt === "k8s" ? fmt : "env";
  const s = getSettings();
  const text = buildConfigExport(
    {
      brokerUrl: s.brokerUrl,
      backendSource: s.backendSource,
      aiProvider: s.aiProvider,
      aiModel: s.aiModel,
      oidcIssuerUrl: s.oidcIssuerUrl,
      auditLevel: auditStatus().level,
    },
    format,
  );
  res.type("text/plain").send(text);
});

// GET /api/setup/config-dir — admin: what the deployment config directory
// (OMNI_CONFIG_DIR) loaded (vendor overlay counts, config applied, errors), plus the
// `.old` backup's age — the SPA nudges the admin to clear it out once `stale`.
router.get("/setup/config-dir", requireRole("admin"), (_req, res) => {
  res.json({ ...configDirSummary(), backup: configBackupInfo() });
});

// POST /api/setup/config-dir/refresh — admin + step-up: hot-reload the config directory
// NOW instead of waiting for a restart (the operator has already edited the files on
// disk). Backs the current directory up to `.old` first and auto-reverts to it if the
// new load reports any file error, so a bad hand-edit can never leave the gateway
// running on a half-applied broken config.
router.post("/setup/config-dir/refresh", requireRole("admin"), requireStepUp, (_req, res) => {
  const result = refreshConfigDir();
  const session = getSession(_req);
  recordAudit({
    ts: new Date().toISOString(), category: "admin", action: "config-dir.refresh",
    actor: session ? { sub: session.sub, email: session.email } : null, write: true,
    result: result.ok ? "success" : "error",
    meta: { errors: result.summary.errors.length, warnings: result.summary.warnings.length, reverted: result.reverted, backedUp: result.backedUp },
  });
  // Always 200: the REQUEST succeeded (a refresh was attempted and completed one way or
  // another) regardless of whether the new config was accepted — `ok`/`reverted` on the
  // body carry that outcome, so the SPA can render "applied" / "reverted, here's why" /
  // "failed, no backup to revert to" without treating any of them as a transport error.
  res.json(result);
});

// POST /api/setup/config-dir/clear-backup — admin: delete the `.old` backup (the 30-day
// cleanup nudge's action). Not step-up gated — the backup carries no more privilege than
// the live config already does, and this is a routine housekeeping action, not a change
// to live behaviour.
router.post("/setup/config-dir/clear-backup", requireRole("admin"), (_req, res) => {
  const cleared = clearConfigBackup();
  const session = getSession(_req);
  recordAudit({
    ts: new Date().toISOString(), category: "admin", action: "config-dir.clear-backup",
    actor: session ? { sub: session.sub, email: session.email } : null, write: true,
    result: cleared ? "success" : "error",
  });
  res.json({ cleared });
});

// GET /api/setup/config-bundle — admin "lock this config": download the current
// effective config as the exact folder-of-JSON the loader reads (read ≡ dump).
router.get("/setup/config-bundle", requireRole("admin"), (_req, res) => {
  const zip = buildConfigBundle();
  res.type("application/zip").set("Content-Disposition", 'attachment; filename="omniproject-config.zip"').send(zip);
});

// GET /api/setup/backends — full manifest catalogue for the Configurator (docs URLs,
// required env, actions, capabilities). Internal: restricted to PMO/admin, the only
// entity that wires backends. Admin-only backends (raw SQL / Mongo) are additionally
// hidden from a plain PMO caller so they aren't offered a technical integration they
// can't configure (wiring one is admin-gated at generate-workflow / settings regardless
// — this just keeps the wizard honest per authority).
router.get("/setup/backends", requireAnyRole("pmo", "admin"), (req, res) => {
  const isAdmin = hasRole(req, "admin"); // the technical authority
  res.json(backendCatalogue().filter((b) => isAdmin || !b.adminOnly));
});

// GET /api/setup/backends/ids — the OUTER surface: just the ids, for the one
// non-Configurator consumer (Settings' backend-source suggestion dropdown). Same
// admin-only filter, but no manifest detail passed through.
router.get("/setup/backends/ids", (req, res) => {
  const isAdmin = hasRole(req, "admin");
  res.json(backendCatalogue().filter((b) => isAdmin || !b.adminOnly).map((b) => b.id));
});

// The other two integration planes (same shape): which brokers can serve the
// data hop, and which outward interfaces expose data/events. Internal: both are
// Configurator-only reads of live wiring, restricted to PMO/admin.
// Full broker catalogue, or — with ?connected=1 — only the broker KIND(S) actually
// wired to this deployment (the active hop ∪ BROKER_KINDS), the set the capability
// resolver unions over.
router.get("/setup/brokers", requireAnyRole("pmo", "admin"), (req, res) => {
  if (req.query["connected"] !== "1") { res.json(brokerCatalogue()); return; }
  const kinds = new Set(connectedBrokerKinds());
  res.json(brokerCatalogue().filter((b) => kinds.has(b.id)));
});
router.get("/setup/outputs", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json(outputCatalogue());
});
// Internal: the Configurator's NotificationPicker is its only SPA consumer, so this
// is restricted to PMO/admin like the other wiring-catalogue reads above.
router.get("/setup/notifications", requireAnyRole("pmo", "admin"), (_req, res) => {
  res.json(notificationCatalogue());
});
// The notification ROUTING rules (JSON-defined) — which event kinds dispatch to
// which delivery channels. The generic dispatch decision; delivery is below the seam.
router.get("/setup/notification-routes", (_req, res) => {
  res.json(notificationRouteCatalogue());
});
// The canonical notification KINDS + their severity — the vocabulary routes match on.
router.get("/setup/notification-kinds", (_req, res) => {
  res.json(notificationKindCatalogue());
});
router.get("/setup/methodologies", (_req, res) => {
  res.json(methodologyCatalogue().filter((m) => methodologyAllowed(m.id)));
});
// A methodology PACK — the methodology's definition + every asset carrying its tag
// (views, notification routes, ruleset), as one importable JSON bundle. Admin only:
// it's the portable look-and-feel an operator drops into another deployment's config.
router.get("/setup/methodology-pack/:id", requireRole("admin"), (req, res) => {
  const pack = methodologyPack(String(req.params["id"]));
  if (!pack) { res.status(404).json({ error: "Unknown methodology" }); return; }
  res.setHeader("Content-Disposition", `attachment; filename="methodology-${pack.methodology.id}.json"`);
  res.json(pack);
});
// The board views (JSON-defined) + the cross-plane DERIVED methodology tag list.
// With ?methodology=<tag>, only the views that methodology activates (+ neutral ones).
router.get("/setup/views", (req, res) => {
  const m = req.query["methodology"];
  const views = typeof m === "string" && m ? viewsForMethodology(m) : VIEWS;
  res.json({ views, methodologies: allMethodologyTags() });
});
// The DERIVED methodology PRESET — every asset a methodology activates, across
// planes (views, reports, screens), so a "click kanban" preset surfaces them all.
router.get("/setup/methodology-preset/:id", (req, res) => {
  const id = String(req.params["id"]);
  res.json({ methodology: id, views: viewsForMethodology(id), reports: reportsForMethodology(id).filter((r) => reportAllowed(r.id)), screens: screensForMethodology(id) });
});
// Full catalogue (what OmniProject CAN do), or — with ?available=1 — only the
// entries the CONNECTED backend(s) can actually feed. The hard rule: if none of
// the connected backends support a report/screen, ?available=1 omits it. (`caps`
// is the resolved set — already the union across every connected backend.)
// Internal: the Configurator's report-picker is its only SPA consumer, so this
// is restricted to PMO/admin like the other wiring-catalogue reads above.
router.get("/setup/reports", requireAnyRole("pmo", "admin"), async (req, res) => {
  // Governance gate first (a forbidden report is withheld regardless of backend support), then the
  // backend-capability filter when ?available=1.
  if (req.query["available"] !== "1") { res.json(reportCatalogue().filter((r) => reportAllowed(r.id))); return; }
  const support = await resolveSupport(req).catch(() => null);
  const base = support ? availableReports(support) : reportCatalogue();
  res.json(base.filter((r) => reportAllowed(r.id)));
});
router.get("/setup/screens", async (req, res) => {
  if (req.query["available"] !== "1") { res.json(screenCatalogue()); return; }
  const support = await resolveSupport(req).catch(() => null);
  res.json(support ? availableScreens(support) : screenCatalogue());
});

// Per-screen layout overrides (drag-arranged panel order / spans / hidden). Stored
// in the settings store, so they ride the snapshot/export into the customer's JSON.
// GET is open (the SPA needs it to render); PUT is manager+ (a shared customer view).
router.get("/setup/screens/:id/layout", (req, res) => {
  const layout = getSettings().screenLayouts[String(req.params["id"])] ?? null;
  res.json({ id: req.params["id"], layout });
});

router.put("/setup/screens/:id/layout", requireRole("manager"), (req, res) => {
  const id = String(req.params["id"]);
  const body = (req.body ?? {}) as { order?: unknown; spans?: unknown; hidden?: unknown };
  const layout: { order?: string[]; spans?: Record<string, number>; hidden?: string[] } = {};
  if (Array.isArray(body.order)) layout.order = body.order.filter((x): x is string => typeof x === "string");
  if (body.spans && typeof body.spans === "object") {
    layout.spans = Object.fromEntries(
      Object.entries(body.spans as Record<string, unknown>)
        .filter(([, v]) => typeof v === "number" && (v as number) >= 1 && (v as number) <= 12) as [string, number][],
    );
  }
  if (Array.isArray(body.hidden)) layout.hidden = body.hidden.filter((x): x is string => typeof x === "string");

  const next = { ...getSettings().screenLayouts, [id]: layout };
  updateSettings({ screenLayouts: next });
  captureVersion(`screen layout: ${id}`);
  res.json({ id, layout });
});
// GET /api/setup/connections?backends=a,b — the vendor credentials the broker(s)
// need for the selected backends, plus fill-in templates. Admin-only. Returns only
// credential NAMES + placeholders; OmniProject never holds the secret values.
router.get("/setup/connections", requireRole("admin"), (req, res) => {
  const raw = typeof req.query["backends"] === "string" ? (req.query["backends"] as string) : "";
  const fromQuery = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const source = getSettings().backendSource;
  const backends = fromQuery.length ? fromQuery : source && source !== "all" && source !== "none" ? [source] : [];
  const credentials = requiredCredentials(backends);
  res.json({
    backends,
    credentials,
    templates: {
      env: renderCredentialTemplate(credentials, "env"),
      compose: renderCredentialTemplate(credentials, "compose"),
    },
  });
});

// POST /api/setup/connections/test — ask the broker to verify it can reach a
// backend with its configured credentials. Admin-only.
router.post("/setup/connections/test", requireRole("admin"), async (req, res) => {
  const parsed = parseOr400(req, res, CONNECTION_TEST_BODY);
  if (!parsed) return;
  const result = await callBrokerCapability(
    brokerVerifyConnection(contextFromReq(req), parsed.backend),
    res,
    { unsupported: { ok: false, error: "this broker does not support connection tests" }, failed: (m) => ({ ok: false, error: m }) },
  );
  if (result) res.json(result);
});

// POST /api/setup/connections/vault — DELEGATE a vendor credential to the broker's
// own encrypted credential store. The secret is relayed ONCE and never persisted by
// OmniProject (not stored, not logged). 501 when the broker has no vault. Admin-only.
router.post("/setup/connections/vault", requireRole("admin"), async (req, res) => {
  const parsed = parseOr400(req, res, CONNECTION_VAULT_BODY);
  if (!parsed) return;
  const result = await callBrokerCapability(
    brokerStoreCredential(contextFromReq(req), parsed), // result carries only a non-secret ref
    res,
    {
      unsupported: { stored: false, error: "this broker has no credential vault — use the env/Docker-secret template instead" },
      failed: (m) => ({ stored: false, error: m }),
    },
  );
  if (result) res.json({ stored: result.stored, ref: result.ref ?? null });
});

// The plane meta-registry — all seven planes + their dev docs.
router.get("/setup/planes", (_req, res) => {
  res.json(planeCatalogue());
});

// Entity-resolution PREVIEW — illustrates reconciling the same real-world entity
// across backends. Runs the stateless helpers over an ILLUSTRATIVE sample (no real
// customer data; nothing is stored). A real deployment feeds records from its
// connected backends and persists any CONFIRMED mapping as JSON in its config dir —
// the truth stays in the backends, never at rest here.
router.get("/setup/entity-resolution/preview", (_req, res) => {
  interface SampleContact { source: string; name: string; email?: string; externalId?: string }
  const sample: SampleContact[] = [
    { source: "jira", name: "Alice Smith", email: "alice@acme.io", externalId: "u-1" },
    { source: "salesforce", name: "Alice Smith", email: "ALICE@acme.io", externalId: "c-9" },
    { source: "erp", name: "alice  smith", email: "alice@acme.io" },
    { source: "jira", name: "Bob Jones", email: "bob@acme.io", externalId: "u-2" },
  ];
  res.json({
    note: "Illustrative sample — no customer data is read or stored. Confirmed mappings would live in the config dir as JSON.",
    deduped: dedupeEntities(sample, (c) => normaliseKey(c.email)),
    candidates: matchCandidates(sample, [
      { name: "email", fn: (c) => normaliseKey(c.email) },
      { name: "name", fn: (c) => normaliseKey(c.name) },
    ]),
  });
});

// POST /api/setup/generate-workflow — emit an importable n8n workflow for the
// chosen backend. Stateless: returned for download, nothing stored. Admin only.
// readOnly (default true) omits every write action, so the quickstart default
// is a workflow that cannot mutate the backend even before anyone reviews it.
router.post("/setup/generate-workflow", requireRole("admin"), (req, res) => {
  const backendId = typeof req.body?.backendId === "string" ? req.body.backendId : "";
  const webhookPath = typeof req.body?.webhookPath === "string" ? req.body.webhookPath : undefined;
  const readOnly = typeof req.body?.readOnly === "boolean" ? req.body.readOnly : true;
  const manifest = getBackend(backendId);
  if (!manifest) {
    res.status(404).json({ error: `Unknown backend: ${backendId}` });
    return;
  }
  // Enterprise backend workflows (SAP, Primavera, Dynamics 365, …) are premium.
  if (isEnterpriseBackend(backendId) && !isEntitled("enterprise_workflows")) {
    res.status(402).json({
      error: `Generating the ${manifest.label} workflow is a licensed enterprise integration. Add a valid LICENSE_KEY with the "enterprise_workflows" feature.`,
      feature: "enterprise_workflows",
      backend: backendId,
      license: resolveLicense(),
    });
    return;
  }
  const workflow = generateWorkflow(manifest, { webhookPath, readOnly });
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-${manifest.id}${readOnly ? "-readonly" : ""}.json"`)
    .send(JSON.stringify(workflow, null, 2));
});

// POST /api/setup/verify-workflow — probe the configured broker with verify:true
// for each non-mutating action and report per-action conformance. Admin only.
// The { verify: true } flag lets a generated workflow short-circuit so nothing
// touches the backend; only read/declarative actions are probed regardless.
router.post("/setup/verify-workflow", requireRole("admin"), async (req, res) => {
  const url = (typeof req.body?.webhookUrl === "string" && req.body.webhookUrl.trim()) || getSettings().brokerUrl;
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "No broker webhook configured. Connect the broker first or pass webhookUrl." });
    return;
  }
  try {
    await assertEgressAllowed(url); // SSRF guard: never let an admin-pasted URL reach metadata/link-local
  } catch (err) {
    res.status(400).json({ error: err instanceof EgressError ? err.message : "That webhook URL is not allowed." });
    return;
  }
  const sampleProjectId = typeof req.body?.projectId === "string" ? req.body.projectId : "sample";

  const results = await probeVerifiableActions(url, sampleProjectId);

  const passed = results.filter((r) => r.ok).length;
  res.json({
    webhookUrl: url,
    summary: { passed, total: results.length, verifyAware: results.some((r) => r.verifyAware) },
    results,
    note: "Write actions (create/update/delete) are not probed to avoid mutating your backend. A generated workflow honours { verify: true } so even reads never hit the backend.",
  });
});

// GET /api/setup/snapshot — download a portable JSON backup of gateway config.
router.get("/setup/snapshot", requireRole("admin"), (_req, res) => {
  const snapshot = buildSnapshot(getSettings());
  res
    .type("application/json")
    .set("Content-Disposition", `attachment; filename="omniproject-snapshot.json"`)
    .send(JSON.stringify(snapshot, null, 2));
});

// POST /api/setup/restore — restore config from a snapshot (e.g. after a bad
// port/setup). Validates the snapshot, applies known settings, reports warnings.
router.post("/setup/restore", requireRole("admin"), (req, res) => {
  try {
    const { patch, warnings } = applySnapshot(req.body);
    const settings = updateSettings(patch);
    captureVersion("restored from snapshot");
    res.json({ restored: true, warnings, settings });
  } catch (err) {
    res.status(400).json({ restored: false, error: err instanceof Error ? err.message : "Invalid snapshot" });
  }
});

// ── Environments & versioned rollback ─────────────────────────────────────────

function handle(res: Response, fn: () => unknown): void {
  try {
    res.json(fn());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "error" });
  }
}

// GET /api/setup/environments — environments, active env, version history.
router.get("/setup/environments", requireRole("admin"), (_req, res) => {
  res.json(storeView());
});

// POST /api/setup/environments { name } — create a sandbox (clone of active).
router.post("/setup/environments", requireRole("admin"), (req, res) => {
  handle(res, () => createEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/environments/activate { name } — switch the active environment.
router.post("/setup/environments/activate", requireRole("admin"), (req, res) => {
  handle(res, () => activateEnvironment(String(req.body?.name ?? "")));
});

// POST /api/setup/promote { from, to } — copy one env's config onto another.
router.post("/setup/promote", requireRole("admin"), (req, res) => {
  handle(res, () => promote(String(req.body?.from ?? ""), String(req.body?.to ?? "")));
});

// POST /api/setup/versions/:id/known-good — pin a version as known-good.
router.post("/setup/versions/:id/known-good", requireRole("admin"), (req, res) => {
  handle(res, () => markKnownGood(String(req.params["id"])));
});

// POST /api/setup/rollback { versionId? , toKnownGood? } — fast rollback.
router.post("/setup/rollback", requireRole("admin"), (req, res) => {
  try {
    const result = req.body?.toKnownGood
      ? rollbackToLastKnownGood()
      : rollbackTo(String(req.body?.versionId ?? ""));
    res.json({ rolledBack: true, appliedVersion: result.applied.id, warnings: result.warnings, store: storeView() });
  } catch (err) {
    res.status(400).json({ rolledBack: false, error: err instanceof Error ? err.message : "error" });
  }
});

// GET /api/setup/debug-bundle — a reproducible ZIP of config + loaded vendors +
// demo data + captured broker/notify/export traffic, for sharing on a GitHub issue
// or reloading on another instance to replicate a problem. Available ONLY in dev
// mode (refused in production — dev mode is hard-gated off there), admin-only.
router.get("/setup/debug-bundle", requireRole("admin"), (_req, res) => {
  if (!isDevMode()) {
    res.status(409).json({
      error: "Debug bundle is available only in developer mode (a non-production build with OMNI_DEV_MODE / DEV_PERSIST_FILE / BROKER_TRACE / BROKER_CAPTURE). Production is stateless and never bundles.",
    });
    return;
  }
  const now = new Date().toISOString();
  const zip = buildDebugBundleZip(now);
  res
    .type("application/zip")
    .set("Content-Disposition", `attachment; filename="omniproject-debug-bundle-${now.slice(0, 10)}.zip"`)
    .send(zip);
});

export default router;
