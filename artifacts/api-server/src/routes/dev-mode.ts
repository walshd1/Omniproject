import { Router } from "express";
import { backendCatalogue } from "@workspace/backend-catalogue";
import { devModeStatus, isDevMode } from "../lib/dev-mode";
import { requireRole, roleFromClaims, hasRole, hasStrongAuth } from "../lib/rbac";
import { isDemoAuth } from "../lib/auth-config";
import { requireStepUp } from "../lib/step-up";
import { getDevBrokerConfig, setDevBrokerConfig, DEV_DATA_SOURCES, type DevDataSource } from "../broker/dev-broker";
import { resetBroker } from "../broker";
import { getRealSession, startImpersonation, stopImpersonation } from "./auth";
import { activeImpersonation, IMPERSONATION_TTL_MS } from "../lib/impersonation";
import { recordAudit } from "../lib/audit";
import { LICENSE_FEATURES, licenseSummary, type LicenseFeature } from "../lib/license";
import { getDevEntitlementOverrides, setDevEntitlementOverride, clearDevEntitlementOverrides } from "../lib/dev-entitlements";
import { getMessyConfig, setMessyConfig, MESSY_GREMLINS } from "../lib/messy-data";

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

/** Gate a route to an active dev instance (409 otherwise) — applied to every
 *  dev-only endpoint so the check lives in one place, not in each handler. */
function requireDevMode(_req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (isDevMode()) { next(); return; }
  res.status(409).json({ error: "dev mode is not active" });
}

router.get("/dev-mode", (_req, res) => {
  res.json(devModeStatus());
});

router.get("/dev-mode/broker", requireDevMode, requireRole("admin"), (_req, res) => {
  res.json({
    config: getDevBrokerConfig(),
    sources: DEV_DATA_SOURCES,
    vendors: backendCatalogue().map((b) => ({ id: b.id, label: b.label })),
  });
});

router.post("/dev-mode/broker", requireDevMode, requireRole("admin"), (req, res) => {
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

// ── Synthetic messy-data injection ────────────────────────────────────────────
// Inject real-world imperfections (nulls, mixed enum vocab, junk numbers/dates,
// missing provenance, id collisions…) into the read model so we can watch how
// resilient reports/derivations are to dirty data. Dev-only; admin; resets the
// broker so the next read reflects the new config. Inert in production.

/** GET — the current messy-data config + the gremlin catalogue. */
router.get("/dev-mode/messy", requireDevMode, requireRole("admin"), (_req, res) => {
  res.json({ config: getMessyConfig(), gremlins: MESSY_GREMLINS });
});

/** POST — set { on?, seed?, intensity?, gremlins? } on the fly. */
router.post("/dev-mode/messy", requireDevMode, requireRole("admin"), (req, res) => {
  const body = (req.body ?? {}) as { on?: unknown; seed?: unknown; intensity?: unknown; gremlins?: unknown };
  const patch: Partial<ReturnType<typeof getMessyConfig>> = {};

  if (body.on !== undefined) patch.on = !!body.on;
  if (body.seed !== undefined) {
    if (typeof body.seed !== "string" || !body.seed.trim()) {
      res.status(400).json({ error: "seed must be a non-empty string" });
      return;
    }
    patch.seed = body.seed.trim();
  }
  if (body.intensity !== undefined) {
    if (typeof body.intensity !== "number" || !Number.isFinite(body.intensity) || body.intensity < 0 || body.intensity > 1) {
      res.status(400).json({ error: "intensity must be a number between 0 and 1" });
      return;
    }
    patch.intensity = body.intensity;
  }
  if (body.gremlins !== undefined) {
    if (!Array.isArray(body.gremlins) || body.gremlins.some((g) => typeof g !== "string")) {
      res.status(400).json({ error: "gremlins must be an array of gremlin ids" });
      return;
    }
    const known = new Set(MESSY_GREMLINS.map((g) => g.id));
    const unknown = (body.gremlins as string[]).filter((g) => !known.has(g));
    if (unknown.length) {
      res.status(400).json({ error: `unknown gremlin(s): ${unknown.join(", ")}` });
      return;
    }
    patch.gremlins = body.gremlins as string[];
  }

  const config = setMessyConfig(patch);
  recordAudit({
    ts: new Date().toISOString(),
    category: "admin",
    action: "dev_messy_data_config",
    actor: { sub: getRealSession(req)?.sub ?? "unknown", role: "admin" },
    status: 200,
    write: true,
    meta: { devMode: true, on: config.on, intensity: config.intensity, gremlins: config.gremlins },
  });
  resetBroker(); // next getBroker() rebuilds with (or without) the messy wrap
  res.json({ config });
});

// ── Ephemeral dev-mode impersonation ──────────────────────────────────────────
// Auth bypass for reproducing role-specific issues. Hard-gated: dev only; the
// REAL caller must be admin; a reason is required (the UI approval dialog); and it
// expires (IMPERSONATION_TTL_MS). Every start/stop is audited with the reason.

/** Is the REAL caller (ignoring impersonation) an admin? */
function isRealAdmin(req: import("express").Request): boolean {
  const real = getRealSession(req);
  // Honour the same strong-auth gate as grantsForReq: the admin authority is withheld without
  // hardware-bound MFA, so a merely-claimed admin can't override dev entitlements. (Without passing
  // strongAuth, grantsFromClaims defaults it to true and skips the check.)
  return roleFromClaims(real?.roles ?? [], { isDemo: isDemoAuth(), strongAuth: hasStrongAuth(real) }) === "admin";
}

/** Middleware: only the REAL admin may mutate entitlement overrides (403 otherwise). */
function requireRealAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  if (!isRealAdmin(req)) {
    res.status(403).json({ error: "only a real admin may override entitlements" });
    return;
  }
  next();
}

/** GET — the current impersonation (for the UI banner), or null. Zero trust: being
 *  authenticated at all must not imply the right to read this — a plain session
 *  with no impersonation of its own may only read it if it's the REAL admin who
 *  could have started one (so a viewer that's currently BEING impersonated still
 *  sees its own "Impersonating X — stop" banner; an unrelated viewer cannot probe
 *  this endpoint at all). */
router.get("/dev-mode/impersonate", requireDevMode, (req, res) => {
  const imp = activeImpersonation(getRealSession(req));
  if (!imp && !isRealAdmin(req)) {
    res.status(403).json({ error: "admin only" });
    return;
  }
  res.json({ impersonation: imp ? { sub: imp.sub, email: imp.email, roles: imp.roles, reason: imp.reason, by: imp.by, expiresAt: imp.expiresAt } : null });
});

/** POST — start impersonating { sub, email?, roles?, reason }. Real-admin only, and
 *  — like every other identity-altering action in the app — requires a FRESH
 *  step-up: this is the single highest-risk action available (assuming a whole
 *  other identity), so holding an admin session alone is not enough on its own. */
router.post("/dev-mode/impersonate", requireDevMode, requireStepUp, (req, res) => {
  const real = getRealSession(req);
  // Reuse the hardened admin gate (`hasRole`) rather than a bare role-from-claims check: it
  // enforces the WebAuthn strong-auth step-up, merges SCIM group claims, and honours
  // deprovision — exactly like every other admin gate. No impersonation is active yet, so
  // getSession() (which hasRole reads) is the real session here.
  if (!real || !hasRole(req, "admin")) {
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
router.delete("/dev-mode/impersonate", requireDevMode, (req, res) => {
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

/** GET — the catalogue, current overrides, and the effective entitlements. Admin
 *  only: unlike the impersonation banner, no other role has a legitimate reason to
 *  read this, so a plain authenticated session gets no implicit access here. */
router.get("/dev-mode/entitlements", requireDevMode, requireRole("admin"), (req, res) => {
  res.json({ catalog: LICENSE_FEATURES, overrides: getDevEntitlementOverrides(), effective: licenseSummary().features });
});

/** POST — force a feature: { feature, enabled: true|false|null(clear) }. */
router.post("/dev-mode/entitlements", requireDevMode, requireRealAdmin, (req, res) => {
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
router.delete("/dev-mode/entitlements", requireDevMode, requireRealAdmin, (req, res) => {
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
