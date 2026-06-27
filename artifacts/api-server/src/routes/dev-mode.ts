import { Router } from "express";
import { backendCatalogue } from "@workspace/backend-catalogue";
import { devModeStatus, isDevMode } from "../lib/dev-mode";
import { requireRole, roleFromClaims } from "../lib/rbac";
import { getDevBrokerConfig, setDevBrokerConfig, DEV_DATA_SOURCES, type DevDataSource } from "../broker/dev-broker";
import { resetBroker } from "../broker";
import { getRealSession, startImpersonation, stopImpersonation } from "./auth";
import { activeImpersonation, IMPERSONATION_TTL_MS } from "../lib/impersonation";
import { recordAudit } from "../lib/audit";
import { LICENSE_FEATURES, licenseSummary, type LicenseFeature } from "../lib/license";
import { getDevEntitlementOverrides, setDevEntitlementOverride, clearDevEntitlementOverrides } from "../lib/dev-entitlements";

/**
 * Dev-mode routes.
 *
 *  - GET  /api/dev-mode — public status (which debug surfaces are armed), so the SPA
 *    can watermark the screen even pre-auth. Always `devMode:false` in production.
 *  - GET  /api/dev-mode/broker — the current dev-broker config + the vendor/source
 *    options (dev only, admin).
 *  - POST /api/dev-mode/broker — switch the spoofed vendor × data source ON THE FLY
 *    (dev only, admin). Resets the broker so the next request uses the new combo.
 *
 * The switch endpoints are inert in production (dev mode is gated off there) and
 * admin-gated; nothing here exists on a released deployment.
 */
const router = Router();

router.get("/dev-mode", (_req, res) => {
  res.json(devModeStatus());
});

router.get("/dev-mode/broker", requireRole("admin"), (_req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  res.json({
    config: getDevBrokerConfig(),
    sources: DEV_DATA_SOURCES,
    vendors: backendCatalogue().map((b) => ({ id: b.id, label: b.label })),
  });
});

router.post("/dev-mode/broker", requireRole("admin"), (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  const body = (req.body ?? {}) as { vendor?: unknown; source?: unknown; ref?: unknown };
  const patch: Partial<{ vendor: string | null; source: DevDataSource; ref: string | null }> = {};

  if (body.vendor !== undefined) {
    const v = typeof body.vendor === "string" ? body.vendor.trim() : "";
    if (v && !backendCatalogue().some((b) => b.id === v)) {
      res.status(400).json({ error: `unknown vendor "${v}"` });
      return;
    }
    patch.vendor = v || null;
  }
  if (body.source !== undefined) {
    if (!DEV_DATA_SOURCES.includes(body.source as DevDataSource)) {
      res.status(400).json({ error: `source must be one of ${DEV_DATA_SOURCES.join(", ")}` });
      return;
    }
    patch.source = body.source as DevDataSource;
  }
  if (body.ref !== undefined) {
    patch.ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : null;
  }

  const config = setDevBrokerConfig(patch);
  if ((config.source === "bundle" || config.source === "cassette") && !config.ref) {
    res.status(400).json({ error: `the '${config.source}' source needs a 'ref' file path` });
    return;
  }
  resetBroker(); // next getBroker() rebuilds with the new combo
  res.json({ switched: true, config });
});

// ── Ephemeral dev-mode impersonation ──────────────────────────────────────────
// Auth bypass for reproducing role-specific issues. Hard-gated: dev only; the
// REAL caller must be admin; a reason is required (the UI approval dialog); and it
// expires (IMPERSONATION_TTL_MS). Every start/stop is audited with the reason.

const isDemoAuth = () => !process.env["OIDC_ISSUER_URL"]?.trim();

/** Is the REAL caller (ignoring impersonation) an admin? */
function isRealAdmin(req: import("express").Request): boolean {
  const real = getRealSession(req);
  return roleFromClaims(real?.roles ?? [], { isDemo: isDemoAuth() }) === "admin";
}

/** GET — the current impersonation (for the UI banner), or null. */
router.get("/dev-mode/impersonate", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  const imp = activeImpersonation(getRealSession(req));
  res.json({ impersonation: imp ? { sub: imp.sub, email: imp.email, roles: imp.roles, reason: imp.reason, by: imp.by, expiresAt: imp.expiresAt } : null });
});

/** POST — start impersonating { sub, email?, roles?, reason }. Real-admin only. */
router.post("/dev-mode/impersonate", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  const real = getRealSession(req);
  const realRole = roleFromClaims(real?.roles ?? [], { isDemo: isDemoAuth() });
  if (!real || realRole !== "admin") {
    res.status(403).json({ error: "only a real admin may start an impersonation" });
    return;
  }
  const body = (req.body ?? {}) as { sub?: unknown; email?: unknown; roles?: unknown; reason?: unknown };
  const sub = typeof body.sub === "string" ? body.sub.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!sub) {
    res.status(400).json({ error: "a target 'sub' is required" });
    return;
  }
  if (reason.length < 3) {
    res.status(400).json({ error: "a 'reason' is required to impersonate (it is recorded in the audit log)" });
    return;
  }
  const roles = Array.isArray(body.roles) ? body.roles.filter((r): r is string => typeof r === "string") : undefined;
  const expiresAt = Date.now() + IMPERSONATION_TTL_MS;
  const ok = startImpersonation(req, res, {
    sub,
    ...(typeof body.email === "string" && body.email.trim() ? { email: body.email.trim() } : {}),
    ...(roles && roles.length ? { roles } : {}),
    reason,
    by: real.sub,
    expiresAt,
  });
  if (!ok) {
    res.status(401).json({ error: "no active session to attach the impersonation to" });
    return;
  }
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "dev_impersonate_start",
    actor: { sub: real.sub, email: real.email, role: "admin" },
    status: 200,
    write: true,
    meta: { devMode: true, target: sub, reason, expiresAt },
  });
  res.json({ impersonating: true, sub, reason, expiresAt });
});

/** DELETE — stop impersonating (de-escalation; any impersonator may stop). */
router.delete("/dev-mode/impersonate", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  const real = getRealSession(req);
  const imp = real?.impersonation;
  stopImpersonation(req, res);
  if (imp) {
    recordAudit({
      ts: new Date().toISOString(),
      category: "admin",
      action: "dev_impersonate_stop",
      actor: { sub: imp.by },
      status: 200,
      write: true,
      meta: { devMode: true, target: imp.sub, reason: imp.reason },
    });
  }
  res.json({ impersonating: false });
});

// ── Dev-mode entitlement (paid-feature) toggle ────────────────────────────────
// Force individual premium features on/off to test licensed vs unlicensed UX
// without a real licence. Dev-only; real admin; ephemeral (in-memory); audited.

/** GET — the catalogue, current overrides, and the effective entitlements. */
router.get("/dev-mode/entitlements", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  res.json({ catalog: LICENSE_FEATURES, overrides: getDevEntitlementOverrides(), effective: licenseSummary().features });
});

/** POST — force a feature: { feature, enabled: true|false|null(clear) }. */
router.post("/dev-mode/entitlements", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  if (!isRealAdmin(req)) {
    res.status(403).json({ error: "only a real admin may override entitlements" });
    return;
  }
  const body = (req.body ?? {}) as { feature?: unknown; enabled?: unknown };
  const feature = typeof body.feature === "string" ? body.feature : "";
  if (!LICENSE_FEATURES.includes(feature as LicenseFeature)) {
    res.status(400).json({ error: `feature must be one of ${LICENSE_FEATURES.join(", ")}` });
    return;
  }
  if (body.enabled !== true && body.enabled !== false && body.enabled !== null) {
    res.status(400).json({ error: "enabled must be true, false, or null (to clear)" });
    return;
  }
  setDevEntitlementOverride(feature, body.enabled);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "dev_entitlement_override",
    actor: { sub: getRealSession(req)?.sub ?? "unknown", role: "admin" },
    status: 200,
    write: true,
    meta: { devMode: true, feature, enabled: body.enabled },
  });
  res.json({ overrides: getDevEntitlementOverrides(), effective: licenseSummary().features });
});

/** DELETE — clear all overrides. */
router.delete("/dev-mode/entitlements", (req, res) => {
  if (!isDevMode()) {
    res.status(409).json({ error: "dev mode is not active" });
    return;
  }
  if (!isRealAdmin(req)) {
    res.status(403).json({ error: "only a real admin may override entitlements" });
    return;
  }
  clearDevEntitlementOverrides();
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "dev_entitlement_clear",
    actor: { sub: getRealSession(req)?.sub ?? "unknown", role: "admin" },
    status: 200,
    write: true,
    meta: { devMode: true },
  });
  res.json({ overrides: getDevEntitlementOverrides(), effective: licenseSummary().features });
});

export default router;
