import { Router } from "express";
import { getSettings, updateSettings } from "../lib/settings";
import { requireRole } from "../lib/rbac";
import { captureVersion } from "../lib/config-store";

/**
 * Gateway-local settings (the broker URL, AI provider, …). Control-plane, never
 * brokered to a backend.
 */
const router = Router();

router.get("/settings", (_req, res) => {
  res.json(getSettings());
});

// Changing settings re-wires the gateway (broker URL, AI provider) — admin only.
// Each change is versioned so it can be rolled back (see config-store).
router.patch("/settings", requireRole("admin"), (req, res) => {
  const settings = updateSettings(req.body ?? {});
  captureVersion("settings updated");
  res.json(settings);
});

export default router;
