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
  try {
    const before = getSettings().backendSource;
    const settings = updateSettings(req.body ?? {});
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
