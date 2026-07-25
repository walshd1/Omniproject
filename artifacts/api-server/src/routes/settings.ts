import { Router } from "express";
import { getSettings, redactSettingsForRead, SettingsValidationError } from "../lib/settings";
import { evaluateConstraints } from "../lib/settings-constraints";
import { listSettingsPresets } from "../lib/settings-presets";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";
import { resetBroker } from "../broker";
import { getSession } from "./auth";
import { applySettingsGuarded } from "../lib/settings-guard";
import { aiProviderAllowed, aiModelAllowed, sttProviderAllowed } from "../lib/ai-allowlist";
import { resolveScopedSettings, getSettingsOverride, setSettingsOverride } from "../lib/settings-scope";
import { assertDelegationAllowed, DelegationDeniedError, type ConfigWriteScope } from "../lib/scoped-config";
import { recordRequestAudit } from "../lib/audit";

/**
 * Gateway-local settings (the broker URL, AI provider, …). Control-plane, never
 * brokered to a backend.
 */
const router = Router();

router.get("/settings", (req, res) => {
  // Read-safe: webhook signing secrets are masked (any authenticated session,
  // incl. read-only API tokens, can reach this). When a programme/project scope is named, the SCOPE-VARIABLE
  // keys (reporting currency, fx policy, priority weights) are folded to that scope's effective value; all
  // other keys stay the org value.
  const programmeId = typeof req.query["programmeId"] === "string" ? req.query["programmeId"] : undefined;
  const projectId = typeof req.query["projectId"] === "string" ? req.query["projectId"] : undefined;
  const effective = programmeId || projectId ? resolveScopedSettings(getSettings(), { programmeId, projectId }) : getSettings();
  res.json(redactSettingsForRead(effective));
});

// The current cross-field incompatibility LOCKS (which admin controls must be disabled or forced,
// and why), derived from the live settings by lib/settings-constraints. The admin panels read this to
// grey out illegal choices proactively — same non-secret, read-safe audience as GET /settings.
router.get("/settings/constraints", (_req, res) => {
  res.json({ locks: evaluateConstraints(getSettings()).locks });
});

// Known-good settings blueprints for common customer archetypes — the setup wizard / configurator
// loads one as a starting point, then the operator tweaks + saves. Read-only, no secrets.
router.get("/settings/presets", (_req, res) => {
  res.json({ presets: listSettingsPresets() });
});

// Changing settings re-wires the gateway (broker URL, AI provider) — admin only.
// Each change is versioned so it can be rolled back (see config-store).
router.patch("/settings", requireRole("admin"), async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Some settings keys carry SECRETS or capability elevations and have dedicated STEP-UP-gated routes
  // that also sanitize the value. Letting the bulk PATCH /settings write them here would bypass BOTH the
  // step-up and that validation (and clobber the whole map):
  //   - capabilityStates → PUT /api/governance/:id (sanitizeCapabilitySetting)
  //   - webhooks         → POST/DELETE /api/webhooks (signing secret; step-up)
  //   - federatedPeers   → PUT /api/federated-peers (peer bearer token; step-up)
  // Refuse them on this path — config-dir/snapshot restore still applies them below the seam.
  const STEP_UP_ONLY_KEYS: Record<string, string> = {
    capabilityStates: "PUT /api/governance/:id",
    webhooks: "POST/DELETE /api/webhooks",
    federatedPeers: "PUT /api/federated-peers",
    // Acceptances are passkey-signed human acts; they can only be set through their own signing route,
    // never as a bulk value (which would grant AI authority with no signature).
    workflowAcceptances: "POST /api/approvals/workflow-acceptances/:workflowId",
  };
  for (const key of Object.keys(STEP_UP_ONLY_KEYS)) {
    if (key in body) {
      res.status(400).json({ error: `${key} is managed via ${STEP_UP_ONLY_KEYS[key]} (step-up required), not PATCH /settings` });
      return;
    }
  }
  // FLOOR gate (§0, roadmap Phase C): a selected AI provider / model / STT engine must be within the org's
  // corresponding allowlist (a lower scope may only narrow it). "none" (off) and the empty model (provider
  // default) are always allowed. Rejected before the write.
  if ("aiProvider" in body && typeof body["aiProvider"] === "string" && !aiProviderAllowed(body["aiProvider"])) {
    res.status(400).json({ error: `AI provider "${body["aiProvider"]}" is not permitted by this deployment's AI provider allowlist` });
    return;
  }
  if ("aiModel" in body && typeof body["aiModel"] === "string" && !aiModelAllowed(body["aiModel"])) {
    res.status(400).json({ error: `AI model "${body["aiModel"]}" is not permitted by this deployment's AI model allowlist` });
    return;
  }
  if ("sttProvider" in body && typeof body["sttProvider"] === "string" && !sttProviderAllowed(body["sttProvider"])) {
    res.status(400).json({ error: `STT provider "${body["sttProvider"]}" is not permitted by this deployment's STT provider allowlist` });
    return;
  }
  try {
    const before = getSettings().backendSource;
    // Governing invariant (§0): a change that REDUCES the security posture is held for a signed sign-off
    // (dual-control, or a single admin's confirm+sign) rather than applied here. A choice/strengthening
    // change applies immediately.
    const guarded = await applySettingsGuarded(body, getSession(req)?.sub ?? "admin");
    if (!guarded.applied) {
      res.status(202).json({
        pending: guarded.pending,
        message: "This change reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox.",
      });
      return;
    }
    captureVersion("settings updated");
    const settings = getSettings();
    // The demo broker's vendor flavour is derived from backendSource at build time,
    // so rebuild it when that changes — the demo re-presents as the new vendor.
    if (settings.backendSource !== before) resetBroker();
    res.json(settings);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ── Scoped settings overrides — a programme/project may override the SCOPE-VARIABLE allow-list only ─────────
function settingsScope(src: { programmeId?: unknown; projectId?: unknown } | undefined): ConfigWriteScope {
  const programmeId = typeof src?.programmeId === "string" && src.programmeId ? src.programmeId : undefined;
  const projectId = typeof src?.projectId === "string" && src.projectId ? src.projectId : undefined;
  if (programmeId && projectId) throw new Error("name only one of programmeId / projectId");
  if (programmeId) return { kind: "programme", programmeId };
  if (projectId) return { kind: "project", projectId };
  throw new Error("name a programmeId or projectId");
}

// GET a scope's stored settings override (the allow-listed keys it varies). Admin-authored → admin-gated read.
router.get("/settings/scope", requireRole("admin"), (req, res) => {
  let scope: ConfigWriteScope;
  try { scope = settingsScope(req.query as { programmeId?: unknown; projectId?: unknown }); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid scope" }); return; }
  res.json({ scope: scope.kind, override: getSettingsOverride(scope) });
});

// PUT a scope's settings override — allow-list only, delegation-gated on `settings`. Non-scope-variable keys
// are rejected (never stored); an invalid value is rejected by the same field validation as org settings.
router.put("/settings/scope", requireRole("admin"), (req, res) => {
  const body = (req.body ?? {}) as { programmeId?: unknown; projectId?: unknown; patch?: unknown };
  let scope: ConfigWriteScope;
  try { scope = settingsScope(body); }
  catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "invalid scope" }); return; }
  try { assertDelegationAllowed("settings", scope); }
  catch (e) {
    if (e instanceof DelegationDeniedError) { res.status(403).json({ error: e.message, code: "delegation_denied", area: e.area, allowed: e.allowed, attempted: e.attempted }); return; }
    throw e;
  }
  const patch = (body.patch ?? {}) as Record<string, unknown>;
  let result: { override: unknown; rejected: string[] };
  try { result = setSettingsOverride(scope, patch); }
  catch (e) {
    if (e instanceof SettingsValidationError) { res.status(400).json({ error: e.message }); return; }
    throw e;
  }
  recordRequestAudit(req, {
    category: "admin", action: "settings_scope_override", result: "success", status: 200,
    meta: { scope: scope.kind, keys: Object.keys((result.override ?? {}) as object), rejected: result.rejected },
  });
  res.json({ scope: scope.kind, ...result });
});

export default router;
