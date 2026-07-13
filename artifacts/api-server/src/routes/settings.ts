import { Router } from "express";
import { getSettings, updateSettings, redactSettingsForRead, SettingsValidationError } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";
import { resetBroker } from "../broker";

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

// Changing settings re-wires the gateway (broker URL, AI provider) — admin only.
// Each change is versioned so it can be rolled back (see config-store).
router.patch("/settings", requireRole("admin"), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // capabilityStates is a STEP-UP-gated control (widening a capability to "public" / setting an AI/MCP
  // endpoint). Its dedicated route — PUT /api/governance/:id — requires a fresh step-up AND runs
  // sanitizeCapabilitySetting (clamps state to the capability's supported set, validates the endpoint,
  // rejects unknown ids). Letting the bulk PATCH /settings write it here would bypass BOTH the step-up
  // and that validation (and clobber the whole map). Refuse it on this path — config-dir/snapshot
  // restore still applies it below the seam. See routes/tools.ts PUT /governance/:id.
  if ("capabilityStates" in body) {
    res.status(400).json({ error: "capabilityStates is managed via PUT /api/governance/:id (step-up required), not PATCH /settings" });
    return;
  }
  try {
    const before = getSettings().backendSource;
    const settings = updateSettings(body);
    captureVersion("settings updated");
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
