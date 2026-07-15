import { Router } from "express";
import { getSettings, redactSettingsForRead, SettingsValidationError } from "../lib/settings";
import { evaluateConstraints } from "../lib/settings-constraints";
import { listSettingsPresets } from "../lib/settings-presets";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";
import { resetBroker } from "../broker";
import { getSession } from "./auth";
import { applySettingsGuarded } from "../lib/settings-guard";

/**
 * Gateway-local settings (the broker URL, AI provider, …). Control-plane, never
 * brokered to a backend.
 */
const router = Router();

router.get("/settings", (_req, res) => {
  // Read-safe: webhook signing secrets are masked (any authenticated session,
  // incl. read-only API tokens, can reach this).
  res.json(redactSettingsForRead(getSettings()));
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

export default router;
