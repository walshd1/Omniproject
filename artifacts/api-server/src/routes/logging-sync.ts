import { Router } from "express";
import { requireRole } from "../lib/rbac";
import { artifactStoreEnabled } from "../lib/artifact-store";
import { SettingsValidationError } from "../lib/settings";
import { resolveLoggingSync, sanitizeLoggingSync, LOGGING_SYNC_CONFIG_ID } from "../lib/logging-sync";
import { applyConfigCollectionGuarded } from "../lib/config-guard";
import { captureVersion } from "../lib/config-store";
import { getSession } from "./auth";

/**
 * LOGGING SYNC — the opt-in egress of the gateway's event log to an operator-owned destination (unlocks
 * historical time-travel). It moved out of `SettingsState` into the composition model as the SECURITY-classified
 * `logging-sync` config def (roadmap Phase C). Enabling it (or redirecting the destination) REDUCES the posture,
 * so the write goes through the floor gate — a bound dual-control chain, or the solo confirm+sign, holds it for a
 * signed sign-off; disabling strengthens and applies immediately. `sanitizeLoggingSync` still enforces the
 * url + warranty-acknowledgement precondition (→ 400) before anything is held or applied.
 *
 *  - GET /api/logging-sync — the current resolved config (any authed session; the admin panel reads it).
 *  - PUT /api/logging-sync — set it (admin). Body: `{ loggingSync: { enabled, url, acknowledgedWarranty } }`.
 */
const router = Router();

router.get("/logging-sync", (_req, res) => {
  res.json({ loggingSync: resolveLoggingSync() });
});

router.put("/logging-sync", requireRole("admin"), async (req, res) => {
  if (!artifactStoreEnabled()) { res.status(501).json({ error: "no encrypted-JSON store is configured on this deployment" }); return; }
  let value;
  try {
    value = sanitizeLoggingSync((req.body as { loggingSync?: unknown } | undefined)?.loggingSync);
  } catch (err) {
    if (err instanceof SettingsValidationError) { res.status(400).json({ error: err.message }); return; }
    throw err;
  }
  const guarded = await applyConfigCollectionGuarded(LOGGING_SYNC_CONFIG_ID, "Logging sync", value, getSession(req)?.sub ?? "admin");
  if (!guarded.applied) {
    res.status(202).json({ pending: guarded.pending, message: "This change reduces the security posture and needs a signed sign-off before it applies. See /api/approvals/inbox." });
    return;
  }
  captureVersion("logging sync updated");
  res.json({ loggingSync: resolveLoggingSync() });
});

export default router;
